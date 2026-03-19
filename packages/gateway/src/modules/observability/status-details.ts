import type { PolicyService } from "@tyrum/runtime-policy";
import type { AgentRegistry } from "../agent/registry.js";
import type { SqlDb } from "../../statestore/types.js";
import type { SandboxHardeningProfile } from "../sandbox/hardening.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import { loadSandboxStatus } from "./sandbox-status.js";
import { loadConfigHealth, type ConfigHealthStatus } from "./config-health.js";
import {
  loadActiveModel,
  loadAuthProfileHealth,
  loadCatalogFreshness,
  loadSessionLanes,
  loadQueueDepth,
  type AuthProfilesStatus,
  type CatalogFreshnessStatus,
  type QueueDepthStatus,
  type SessionLaneStatus,
} from "./status-details-helpers.js";

export type SandboxStatus = {
  mode: "observe" | "enforce";
  policy_observe_only: boolean;
  effective_policy_sha256: string;
  hardening_profile: SandboxHardeningProfile;
  elevated_execution_available: boolean | null;
};

export interface StatusDetails {
  model_auth: {
    active_model: {
      model_id: string | null;
      provider: string | null;
      model: string | null;
      fallback_models: string[];
    } | null;
    auth_profiles: AuthProfilesStatus | null;
  };
  catalog_freshness: CatalogFreshnessStatus;
  session_lanes: SessionLaneStatus[];
  queue_depth: QueueDepthStatus | null;
  sandbox: SandboxStatus | null;
  config_health: ConfigHealthStatus;
}

export interface StatusDetailsDeps {
  tenantId: string;
  db?: SqlDb;
  policyService?: PolicyService;
  policyStatus?: { observe_only: boolean; effective_sha256: string };
  toolrunnerHardeningProfile?: SandboxHardeningProfile;
  agents?: AgentRegistry;
  modelsDev?: ModelsDevService;
}

export async function buildStatusDetails(deps: StatusDetailsDeps): Promise<StatusDetails> {
  const tenantId = deps.tenantId.trim();
  const [activeModel, authProfiles, catalog, sessionLanes, queueDepth, sandbox, configHealth] =
    await Promise.all([
      loadActiveModel(deps.agents, tenantId),
      loadAuthProfileHealth(deps.db, tenantId),
      loadCatalogFreshness(deps.db, deps.modelsDev),
      loadSessionLanes(deps.db, tenantId),
      loadQueueDepth(deps.db, tenantId),
      loadSandboxStatus({
        tenantId,
        policyService: deps.policyService,
        policyStatus: deps.policyStatus,
        toolrunnerHardeningProfile: deps.toolrunnerHardeningProfile ?? "baseline",
      }),
      loadConfigHealth({
        tenantId,
        db: deps.db,
        modelsDev: deps.modelsDev,
      }),
    ]);
  return {
    model_auth: { active_model: activeModel, auth_profiles: authProfiles },
    catalog_freshness: catalog,
    session_lanes: sessionLanes,
    queue_depth: queueDepth,
    sandbox,
    config_health: configHealth,
  };
}
