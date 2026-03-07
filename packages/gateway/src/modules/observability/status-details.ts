import type { PolicyService } from "../policy/service.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { SqlDb } from "../../statestore/types.js";
import type { SandboxHardeningProfile } from "../sandbox/hardening.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import { loadSandboxStatus } from "./sandbox-status.js";
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
  mode: "disabled" | "observe" | "enforce";
  policy_enabled: boolean;
  policy_observe_only: boolean;
  effective_policy_sha256: string;
  hardening_profile: SandboxHardeningProfile;
  elevated_execution_available: boolean | null;
};

export interface StatusDetails {
  model_auth: {
    active_model: {
      model_id: string;
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
}

export interface StatusDetailsDeps {
  tenantId: string;
  db?: SqlDb;
  policyService?: PolicyService;
  policyStatus?: { enabled: boolean; observe_only: boolean; effective_sha256: string };
  toolrunnerHardeningProfile?: SandboxHardeningProfile;
  agents?: AgentRegistry;
  modelsDev?: ModelsDevService;
}

export async function buildStatusDetails(deps: StatusDetailsDeps): Promise<StatusDetails> {
  const tenantId = deps.tenantId.trim();
  const [activeModel, authProfiles, catalog, sessionLanes, queueDepth, sandbox] = await Promise.all(
    [
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
    ],
  );
  return {
    model_auth: { active_model: activeModel, auth_profiles: authProfiles },
    catalog_freshness: catalog,
    session_lanes: sessionLanes,
    queue_depth: queueDepth,
    sandbox,
  };
}
