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
import type { AuthProfileDal } from "../modules/models/auth-profile-dal.js";
import type { SessionProviderPinDal } from "../modules/models/session-pin-dal.js";
import type { ModelsDevService } from "../modules/models/models-dev-service.js";
import { isAuthProfilesEnabled } from "../modules/models/auth-profiles-enabled.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import { buildStatusDetails } from "../modules/observability/status-details.js";

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
  authProfileDal?: AuthProfileDal;
  pinDal?: SessionProviderPinDal;
  modelsDev?: ModelsDevService;
  agents?: AgentRegistry;
}

export function createStatusRoutes(deps: StatusRouteDeps): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    const policy = deps.policyService ? await deps.policyService.getStatus() : null;
    const details = await buildStatusDetails({
      db: deps.db,
      policyService: deps.policyService,
      agents: deps.agents,
      modelsDev: deps.modelsDev,
    });
    const authProfilesEnabled = isAuthProfilesEnabled();

    let authProfiles: unknown = null;
    if (deps.authProfileDal && deps.pinDal) {
      const profiles = await deps.authProfileDal.list({ limit: 500 });
      const pins = await deps.pinDal.list({ limit: 500 });
      authProfiles = {
        enabled: authProfilesEnabled,
        profiles: {
          total: profiles.length,
          active: profiles.filter((p) => p.status === "active").length,
          disabled: profiles.filter((p) => p.status === "disabled").length,
          providers: [...new Set(profiles.map((p) => p.provider))].sort(),
        },
        pins: {
          total: pins.length,
        },
      };
    }

    return c.json({
      status: "ok",
      version: deps.version,
      instance_id: deps.instanceId,
      role: deps.role,
      db_kind: deps.dbKind,
      is_exposed: !deps.isLocalOnly,
      otel_enabled: deps.otelEnabled,
      ws: deps.connectionManager?.getStats() ?? null,
      auth_profiles: authProfiles,
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
