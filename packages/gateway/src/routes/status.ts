/**
 * Status routes — operational runtime information.
 *
 * These endpoints are read-only and intended for operator clients and
 * diagnostics. They are protected by the gateway auth middleware when enabled.
 */

import { Hono } from "hono";
import type { SqlDb, StateStoreKind } from "../statestore/types.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { PolicyService } from "../modules/policy/service.js";
import type { ModelsDevService } from "../modules/models/models-dev-service.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import { buildStatusDetails } from "../modules/observability/status-details.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface StatusRouteDeps {
  version: string;
  instanceId: string;
  role: string;
  dbKind: StateStoreKind;
  db: SqlDb;
  isLocalOnly: boolean;
  otelEnabled: boolean;
  connectionManager?: ConnectionManager;
  policyService?: PolicyService;
  modelsDev?: ModelsDevService;
  agents?: AgentRegistry;
}

export function createStatusRoutes(deps: StatusRouteDeps): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    const tenantId = requireTenantId(c);
    const policy = deps.policyService ? await deps.policyService.getStatus() : null;
    const details = await buildStatusDetails({
      tenantId,
      db: deps.db,
      policyService: deps.policyService,
      policyStatus: policy
        ? {
            enabled: policy.enabled,
            observe_only: policy.observe_only,
            effective_sha256: policy.effective_sha256,
          }
        : undefined,
      agents: deps.agents,
      modelsDev: deps.modelsDev,
    });

    return c.json({
      status: "ok",
      version: deps.version,
      instance_id: deps.instanceId,
      role: deps.role,
      db_kind: deps.dbKind,
      is_exposed: !deps.isLocalOnly,
      otel_enabled: deps.otelEnabled,
      ws: deps.connectionManager?.getStats() ?? null,
      policy,
      model_auth: details.model_auth,
      catalog_freshness: details.catalog_freshness,
      session_lanes: details.session_lanes,
      queue_depth: details.queue_depth,
      sandbox: details.sandbox,
    });
  });

  return app;
}
