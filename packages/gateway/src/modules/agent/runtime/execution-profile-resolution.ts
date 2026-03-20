import type { WorkScope } from "@tyrum/contracts";
import { SubagentSessionKey } from "@tyrum/contracts";
import type { LaneQueueScope } from "./turn-engine-bridge.js";
import { getExecutionProfile, normalizeExecutionProfileId } from "../execution-profiles.js";
import type { ExecutionProfile, ExecutionProfileId } from "../execution-profiles.js";
import { WorkboardDal } from "../../workboard/dal.js";
import type { GatewayContainer } from "../../../container.js";

export type ResolvedExecutionProfile = {
  id: ExecutionProfileId;
  profile: ExecutionProfile;
  source: "interaction_default" | "subagent_record" | "subagent_fallback";
};

export async function resolveExecutionProfile(
  deps: {
    container: GatewayContainer;
    agentId: string;
    workspaceId: string;
  },
  input: {
    laneQueueScope?: LaneQueueScope;
    metadata?: Record<string, unknown>;
  },
): Promise<ResolvedExecutionProfile> {
  const laneQueueScope = input.laneQueueScope;
  const isSubagentTurn =
    laneQueueScope &&
    laneQueueScope.lane === "subagent" &&
    laneQueueScope.key.startsWith(`agent:${deps.agentId}:subagent:`) &&
    SubagentSessionKey.safeParse(laneQueueScope.key).success;

  if (!isSubagentTurn) {
    const id: ExecutionProfileId = "interaction";
    return { id, profile: getExecutionProfile(id), source: "interaction_default" };
  }

  const subagentId = (() => {
    const fromMeta = input.metadata?.["subagent_id"];
    if (typeof fromMeta === "string" && fromMeta.trim().length > 0) {
      return fromMeta.trim();
    }

    const parts = laneQueueScope.key.split(":");
    const last = parts.at(-1)?.trim();
    return last && last.length > 0 ? last : undefined;
  })();

  if (!subagentId) {
    const id: ExecutionProfileId = "explorer_ro";
    return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
  }

  try {
    const workboard = new WorkboardDal(deps.container.db);
    const scopeIds = await deps.container.identityScopeDal.resolveScopeIds({
      agentKey: deps.agentId,
      workspaceKey: deps.workspaceId,
    });
    const scope: WorkScope = {
      tenant_id: scopeIds.tenantId,
      agent_id: scopeIds.agentId,
      workspace_id: scopeIds.workspaceId,
    };
    const subagent = await workboard.getSubagent({ scope, subagent_id: subagentId });
    const normalized =
      subagent && typeof subagent.execution_profile === "string"
        ? normalizeExecutionProfileId(subagent.execution_profile)
        : undefined;
    if (!subagent || !normalized) {
      const id: ExecutionProfileId = "explorer_ro";
      return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
    }

    const id: ExecutionProfileId = normalized;
    const profile = getExecutionProfile(normalized);
    if (!profile.allowed_lanes.includes("subagent")) {
      const fallbackId: ExecutionProfileId = "explorer_ro";
      return {
        id: fallbackId,
        profile: getExecutionProfile(fallbackId),
        source: "subagent_fallback",
      };
    }

    return {
      id,
      profile,
      source: "subagent_record",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.container.logger.warn("workboard.subagent_profile_resolve_failed", {
      subagent_id: subagentId,
      error: message,
    });
    const id: ExecutionProfileId = "explorer_ro";
    return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
  }
}
