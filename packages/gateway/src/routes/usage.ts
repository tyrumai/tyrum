/**
 * Usage routes — local accounting for execution attempts.
 *
 * Provider quota polling is best-effort (when auth profiles are enabled):
 * results are cached + rate-limited and failures surface as structured,
 * non-fatal status fields.
 */

import { AttemptCost } from "@tyrum/contracts";
import { Hono } from "hono";
import { isAuthProfilesEnabled } from "../app/modules/models/auth-profiles-enabled.js";
import type { AuthProfileDal } from "../app/modules/models/auth-profile-dal.js";
import type { ConversationProviderPinDal } from "../app/modules/models/conversation-pin-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import {
  ProviderUsagePoller,
  type ProviderUsageResult,
} from "../app/modules/observability/provider-usage.js";
import type { SecretProvider } from "../app/modules/secret/provider.js";
import type { SqlDb } from "../statestore/types.js";
import { safeDetail } from "../utils/safe-detail.js";
import { requireTenantId } from "../app/modules/auth/claims.js";

export interface UsageRouteDeps {
  db: SqlDb;
  authProfileDal?: AuthProfileDal;
  pinDal?: ConversationProviderPinDal;
  secretProviderForTenant?: (tenantId: string) => SecretProvider;
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
  const providerUsagePollers = new Map<string, ProviderUsagePoller>();

  app.get("/usage", async (c) => {
    const tenantId = requireTenantId(c);
    const turnId = c.req.query("turn_id")?.trim() || undefined;
    const key = c.req.query("key")?.trim() || undefined;
    const agentKey = c.req.query("agent_key")?.trim() || undefined;

    const scopeParams = [
      turnId ? "turn_id" : null,
      key ? "key" : null,
      agentKey ? "agent_key" : null,
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
    if (turnId) {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s
           ON s.tenant_id = a.tenant_id
          AND s.step_id = a.step_id
         WHERE s.tenant_id = ?
           AND s.turn_id = ?
           AND a.cost_json IS NOT NULL`,
        [tenantId, turnId],
      );
    } else if (key) {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s
           ON s.tenant_id = a.tenant_id
          AND s.step_id = a.step_id
         JOIN turns r
           ON r.tenant_id = s.tenant_id
          AND r.turn_id = s.turn_id
         WHERE r.tenant_id = ?
           AND r.conversation_key = ?
           AND a.cost_json IS NOT NULL`,
        [tenantId, key],
      );
    } else if (agentKey) {
      const keyPrefix = `agent:${agentKey}:`;
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s
           ON s.tenant_id = a.tenant_id
          AND s.step_id = a.step_id
         JOIN turns r
           ON r.tenant_id = s.tenant_id
          AND r.turn_id = s.turn_id
         WHERE r.tenant_id = ?
           AND substr(r.conversation_key, 1, length(?)) = ?
           AND a.cost_json IS NOT NULL`,
        [tenantId, keyPrefix, keyPrefix],
      );
    } else {
      rows = await deps.db.all<{ cost_json: string | null }>(
        `SELECT cost_json
         FROM execution_attempts
         WHERE tenant_id = ?
           AND cost_json IS NOT NULL`,
        [tenantId],
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
          const poller =
            providerUsagePollers.get(tenantId) ??
            (() => {
              const created = new ProviderUsagePoller({
                tenantId,
                authProfileDal: deps.authProfileDal,
                pinDal: deps.pinDal,
                secretProviderGetter: deps.secretProviderForTenant
                  ? async () => deps.secretProviderForTenant!(tenantId)
                  : undefined,
                logger: deps.logger,
              });
              providerUsagePollers.set(tenantId, created);
              return created;
            })();
          try {
            return await poller.pollLatestPinned();
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
        kind: turnId ? "turn" : key ? "conversation" : agentKey ? "agent" : "deployment",
        turn_id: turnId ?? null,
        key: key ?? null,
        agent_key: agentKey ?? null,
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
