/**
 * Usage routes — local accounting for execution attempts.
 *
 * Provider quota polling is best-effort (when auth profiles are enabled):
 * results are cached + rate-limited and failures surface as structured,
 * non-fatal status fields.
 */

import { AttemptCost } from "@tyrum/schemas";
import { Hono } from "hono";
import { isAuthProfilesEnabled } from "../modules/models/auth-profiles-enabled.js";
import type { AuthProfileDal } from "../modules/models/auth-profile-dal.js";
import type { SessionProviderPinDal } from "../modules/models/session-pin-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import {
  ProviderUsagePoller,
  type ProviderUsageResult,
} from "../modules/observability/provider-usage.js";
import type { SecretProvider } from "../modules/secret/provider.js";
import type { SqlDb } from "../statestore/types.js";
import { safeDetail } from "../utils/safe-detail.js";

export interface UsageRouteDeps {
  db: SqlDb;
  authProfileDal?: AuthProfileDal;
  pinDal?: SessionProviderPinDal;
  secretProvider?: SecretProvider;
  logger?: Logger;
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
  const providerUsagePoller = new ProviderUsagePoller({
    authProfileDal: deps.authProfileDal,
    pinDal: deps.pinDal,
    secretProvider: deps.secretProvider,
    logger: deps.logger,
  });

  app.get("/usage", async (c) => {
    const runId = c.req.query("run_id")?.trim() || undefined;
    const key = c.req.query("key")?.trim() || undefined;
    const agentId = c.req.query("agent_id")?.trim() || undefined;

    const scopeParams = [
      runId ? "run_id" : null,
      key ? "key" : null,
      agentId ? "agent_id" : null,
    ].filter((value): value is string => value !== null);
    if (scopeParams.length > 1) {
      return c.json(
        {
          error: "invalid_request",
          message: `usage scoping params are mutually exclusive: ${scopeParams.join(", ")}`,
        },
        400,
      );
    }

    let rows: Array<{ cost_json: string | null }>;
    if (runId) {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         WHERE s.run_id = ?
           AND a.cost_json IS NOT NULL`,
        [runId],
      );
    } else if (key) {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         JOIN execution_runs r ON r.run_id = s.run_id
         WHERE r.key = ?
           AND a.cost_json IS NOT NULL`,
        [key],
      );
    } else if (agentId) {
      const keyPrefix = `agent:${agentId}:`;
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         JOIN execution_runs r ON r.run_id = s.run_id
         WHERE substr(r.key, 1, length(?)) = ?
           AND a.cost_json IS NOT NULL`,
        [keyPrefix, keyPrefix],
      );
    } else {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT cost_json
         FROM execution_attempts
         WHERE cost_json IS NOT NULL`,
      );
    }

    const totals = newTotals();
    let parsed = 0;
    let invalid = 0;

    for (const row of rows) {
      if (!row.cost_json) continue;
      let json: unknown;
      try {
        json = JSON.parse(row.cost_json) as unknown;
      } catch (err) {
        void err;
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

    const provider: ProviderUsageResult | null = isAuthProfilesEnabled()
      ? await (async () => {
          try {
            return await providerUsagePoller.pollLatestPinned();
          } catch (err) {
            const detail = safeDetail(err);
            deps.logger?.warn("usage.provider_poll_unhandled", {
              code: "provider_poll_failed",
              error: detail ?? "unknown error",
            });
            return {
              status: "unavailable",
              cached: false,
              polled_at: null,
              error: {
                code: "provider_poll_failed",
                message: "Provider usage polling failed.",
                detail,
                retryable: true,
              },
            };
          }
        })()
      : null;

    return c.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      scope: {
        kind: runId ? "run" : key ? "session" : agentId ? "agent" : "deployment",
        run_id: runId ?? null,
        key: key ?? null,
        agent_id: agentId ?? null,
      },
      local: {
        attempts: {
          total_with_cost: rows.length,
          parsed,
          invalid,
        },
        totals,
      },
      provider,
    });
  });

  return app;
}
