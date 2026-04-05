/**
 * Usage routes — local accounting for durable turn items and workflow run steps.
 *
 * Provider quota polling is best-effort (when auth profiles are enabled):
 * results are cached + rate-limited and failures surface as structured,
 * non-fatal status fields.
 */

import { Hono } from "hono";
import { isAuthProfilesEnabled } from "../app/modules/models/auth-profiles-enabled.js";
import type { AuthProfileDal } from "../app/modules/models/auth-profile-dal.js";
import type { ConversationProviderPinDal } from "../app/modules/models/conversation-pin-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import { computeLocalUsageSummary } from "../app/modules/observability/local-usage.js";
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

    const localUsage = await computeLocalUsageSummary(deps.db, {
      tenantId,
      turnId,
      key,
      agentKey,
    });

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
          total_with_cost: localUsage.total_with_cost,
          parsed: localUsage.parsed,
          invalid: localUsage.invalid,
        },
        totals: localUsage.totals,
      },
      provider,
    });
  });

  return app;
}
