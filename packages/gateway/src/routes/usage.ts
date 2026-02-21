/**
 * Usage and cost routes.
 *
 * Local usage is authoritative; provider usage is best-effort guidance.
 */

import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import { AttemptCost, UsageResponse } from "@tyrum/schemas";
import { ContextReportDal } from "../modules/observability/context-report-dal.js";

function sumOr(a: number, b: number | undefined): number {
  return a + (b ?? 0);
}

function parseCostJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export interface UsageRouteOptions {
  db: SqlDb;
}

export function createUsageRoutes(opts: UsageRouteOptions): Hono {
  const app = new Hono();
  const contextDal = new ContextReportDal(opts.db);

  app.get("/usage", async (c) => {
    const sessionId = c.req.query("session_id")?.trim();
    const scopeSessionId = sessionId && sessionId.length > 0 ? sessionId : undefined;

    // Agent usage: derived from context reports (per LLM inference).
    const contextReports = await contextDal.list({
      sessionId: scopeSessionId,
      limit: 200,
    });

    let agentTurns = 0;
    let agentInput = 0;
    let agentOutput = 0;
    let agentTotal = 0;
    let agentDurationMs = 0;

    for (const report of contextReports) {
      const usage = report.usage;
      if (!usage) continue;
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const total = usage.total_tokens ?? input + output;
      const durationMs = usage.duration_ms ?? 0;
      if (input === 0 && output === 0 && total === 0) continue;

      agentTurns += 1;
      agentInput += input;
      agentOutput += output;
      agentTotal += total;
      agentDurationMs += durationMs;
    }

    // Execution usage: derived from attempt cost JSON records.
    const rows = await opts.db.all<{ cost_json: string | null }>(
      "SELECT cost_json FROM execution_attempts WHERE cost_json IS NOT NULL",
    );

    let execAttempts = 0;
    let execInput = 0;
    let execOutput = 0;
    let execTotal = 0;
    let execUsdMicros = 0;
    let execDurationMs = 0;

    for (const row of rows) {
      const raw = row.cost_json;
      if (!raw) continue;
      const json = parseCostJson(raw);
      if (!json) continue;

      const parsed = AttemptCost.safeParse(json);
      if (!parsed.success) continue;

      execAttempts += 1;
      execInput = sumOr(execInput, parsed.data.input_tokens);
      execOutput = sumOr(execOutput, parsed.data.output_tokens);
      execTotal = sumOr(execTotal, parsed.data.total_tokens);
      execUsdMicros = sumOr(execUsdMicros, parsed.data.usd_micros);
      execDurationMs = sumOr(execDurationMs, parsed.data.duration_ms);
    }

    const payload = UsageResponse.parse({
      scope: { session_id: scopeSessionId },
      agent: {
        turns: agentTurns,
        input_tokens: agentInput,
        output_tokens: agentOutput,
        total_tokens: agentTotal,
        duration_ms: agentDurationMs,
      },
      execution: {
        attempts: execAttempts,
        input_tokens: execInput,
        output_tokens: execOutput,
        total_tokens: execTotal,
        usd_micros: execUsdMicros,
        duration_ms: execDurationMs,
      },
      provider: {
        status: "disabled",
      },
    });

    return c.json(payload);
  });

  return app;
}

