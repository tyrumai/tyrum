/**
 * Usage and cost routes.
 *
 * Local usage is authoritative; provider usage is best-effort guidance.
 */

import { Hono } from "hono";
import { readFileSync } from "node:fs";
import type { SqlDb } from "../statestore/types.js";
import { AttemptCost, UsageResponse } from "@tyrum/schemas";
import { ContextReportDal } from "../modules/observability/context-report-dal.js";
import { PolicyBundleService } from "../modules/policy-bundle/service.js";
import type { AuthProfileService } from "../modules/auth-profiles/service.js";
import { ProviderUsageService, providerUsagePollingEnabled } from "../modules/observability/provider-usage.js";
import type { AgentRuntime } from "../modules/agent/runtime.js";
import { parse as parseYaml } from "yaml";

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
  modelGatewayConfigPath?: string;
  authProfileService?: AuthProfileService;
  agentRuntime?: Pick<AgentRuntime, "status">;
}

export function createUsageRoutes(opts: UsageRouteOptions): Hono {
  const app = new Hono();
  const contextDal = new ContextReportDal(opts.db);
  const providerUsageService = new ProviderUsageService({
    policyBundleService: new PolicyBundleService(opts.db),
    authProfileService: opts.authProfileService,
  });

  function parseModelGatewayProvider(
    configPath: string,
    modelName: string,
  ): string | undefined {
    const raw = readFileSync(configPath, "utf8");
    const cfg = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    const models = (cfg["models"] ?? {}) as Record<string, unknown>;
    const modelCfg = (models[modelName] ?? {}) as Record<string, unknown>;
    const provider = typeof modelCfg["target"] === "string" ? modelCfg["target"] : undefined;
    return provider?.trim().length ? provider.trim() : undefined;
  }

  app.get("/usage", async (c) => {
    const agentId =
      c.req.header("x-tyrum-agent-id")?.trim() ||
      process.env["TYRUM_AGENT_ID"]?.trim() ||
      "default";

    const sessionId = c.req.query("session_id")?.trim();
    const scopeSessionId = sessionId && sessionId.length > 0 ? sessionId : undefined;
    const providerQuery = c.req.query("provider")?.trim();

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

    let provider = providerQuery && providerQuery.length > 0 ? providerQuery : undefined;
    if (!provider && opts.agentRuntime && opts.modelGatewayConfigPath) {
      try {
        const status = await opts.agentRuntime.status(true);
        const modelName = status.enabled ? status.model.model : undefined;
        if (modelName) {
          provider = parseModelGatewayProvider(opts.modelGatewayConfigPath, modelName);
        }
      } catch {
        // best-effort
      }
    }

    const providerUsage = await providerUsageService.getUsage({
      enabled: providerUsagePollingEnabled(),
      modelGatewayConfigPath: opts.modelGatewayConfigPath,
      provider,
      sessionId: scopeSessionId,
      agentId,
    });

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
        status: providerUsage.status,
        cached_at: providerUsage.cachedAt,
        error: providerUsage.error,
        data: providerUsage.data,
      },
    });

    return c.json(payload);
  });

  return app;
}
