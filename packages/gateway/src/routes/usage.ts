/**
 * Usage routes — local accounting for execution attempts.
 *
 * This is intentionally minimal: it exposes rollups from the durable
 * execution tables (attempt cost attribution) without provider-side quota
 * polling (which depends on auth profiles).
 */

import { AttemptCost } from "@tyrum/schemas";
import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";

export interface UsageRouteDeps {
  db: SqlDb;
}

type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

function addOptional(total: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? total + value : total;
}

function newTotals(): UsageTotals {
  return {
    duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usd_micros: 0,
  };
}

export function createUsageRoutes(deps: UsageRouteDeps): Hono {
  const app = new Hono();

  app.get("/usage", async (c) => {
    const runId = c.req.query("run_id")?.trim() || undefined;

    const rows = runId
      ? await deps.db.all<{ cost_json: string | null }>(
          `SELECT a.cost_json
           FROM execution_attempts a
           JOIN execution_steps s ON s.step_id = a.step_id
           WHERE s.run_id = ?
             AND a.cost_json IS NOT NULL`,
          [runId],
        )
      : await deps.db.all<{ cost_json: string | null }>(
          `SELECT cost_json
           FROM execution_attempts
           WHERE cost_json IS NOT NULL`,
        );

    const totals = newTotals();
    let parsed = 0;
    let invalid = 0;

    for (const row of rows) {
      if (!row.cost_json) continue;
      let json: unknown;
      try {
        json = JSON.parse(row.cost_json) as unknown;
      } catch {
        invalid += 1;
        continue;
      }
      const cost = AttemptCost.safeParse(json);
      if (!cost.success) {
        invalid += 1;
        continue;
      }

      parsed += 1;
      totals.duration_ms = addOptional(totals.duration_ms, cost.data.duration_ms);
      totals.input_tokens = addOptional(totals.input_tokens, cost.data.input_tokens);
      totals.output_tokens = addOptional(totals.output_tokens, cost.data.output_tokens);
      totals.total_tokens = addOptional(totals.total_tokens, cost.data.total_tokens);
      totals.usd_micros = addOptional(totals.usd_micros, cost.data.usd_micros);
    }

    return c.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      scope: {
        kind: runId ? "run" : "deployment",
        run_id: runId ?? null,
      },
      local: {
        attempts: {
          total_with_cost: rows.length,
          parsed,
          invalid,
        },
        totals,
      },
      provider: null as null,
    });
  });

  return app;
}

