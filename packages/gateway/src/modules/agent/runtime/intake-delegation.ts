import { randomUUID } from "node:crypto";
import type { WorkScope } from "@tyrum/schemas";
import { SubagentSessionKey } from "@tyrum/schemas";
import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/schemas";
import type { LaneQueueScope } from "./turn-engine-bridge.js";
import {
  deriveWorkItemTitle,
  parseIntakeModeDecision,
  type ResolvedAgentTurnInput,
} from "./turn-helpers.js";
import { getExecutionProfile, normalizeExecutionProfileId } from "../execution-profiles.js";
import type { ExecutionProfile, ExecutionProfileId } from "../execution-profiles.js";
import { IntakeModeOverrideDal } from "../intake-mode-override-dal.js";
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

export async function resolveIntakeDecision(
  deps: {
    container: GatewayContainer;
  },
  input: {
    input: AgentTurnRequestT;
    executionProfile: ResolvedExecutionProfile;
    resolved: ResolvedAgentTurnInput;
    mainLaneSessionKey: string;
  },
): Promise<{
  mode: "inline" | "delegate_execute" | "delegate_plan";
  reason_code: string;
}> {
  if (input.executionProfile.id !== "interaction") {
    return { mode: "inline", reason_code: "non_interaction" };
  }

  const requested = input.input.intake_mode;
  if (requested === "inline") {
    return { mode: "inline", reason_code: "request_field" };
  }
  if (requested === "delegate_execute" || requested === "delegate_plan") {
    return { mode: requested, reason_code: "request_field" };
  }

  const key = input.mainLaneSessionKey;

  try {
    const dal = new IntakeModeOverrideDal(deps.container.db);
    const row = await dal.get({ key, lane: "main" });
    const override = row?.intake_mode?.trim()?.toLowerCase() ?? "";
    if (override === "inline") {
      return { mode: "inline", reason_code: "override" };
    }
    if (override === "delegate_execute" || override === "delegate_plan") {
      return { mode: override, reason_code: "override" };
    }
  } catch {
    // Intentional: intake override lookup is best-effort; fall back to default inline.
  }

  return { mode: "inline", reason_code: "default_inline" };
}

export async function delegateFromIntake(
  deps: {
    agentId: string;
    container: GatewayContainer;
  },
  input: {
    executionProfile: ResolvedExecutionProfile;
    mode: "delegate_execute" | "delegate_plan";
    reason_code: string;
    resolved: ResolvedAgentTurnInput;
    scope: WorkScope;
    createdFromSessionKey: string;
  },
): Promise<{ reply: string; work_item_id: string; subagent_id?: string }> {
  const required = ["subagent.spawn", "work.write"] as const;
  for (const cap of required) {
    if (!input.executionProfile.profile.capabilities.includes(cap)) {
      return {
        reply: `Delegation denied: execution profile '${input.executionProfile.id}' lacks capability '${cap}'.`,
        work_item_id: "",
      };
    }
  }

  const scope = input.scope;

  const workboard = new WorkboardDal(deps.container.db);

  const delegatedProfileId: ExecutionProfileId =
    input.mode === "delegate_plan" ? "planner" : "executor_rw";
  const delegatedProfile = getExecutionProfile(delegatedProfileId);

  const title = (() => {
    const firstLine = input.resolved.message.split("\n")[0]?.trim() ?? "";
    const normalized = firstLine.length > 0 ? firstLine : "Delegated work";
    return normalized.slice(0, 140);
  })();

  const workItem = await workboard.createItem({
    scope,
    item: {
      kind: input.mode === "delegate_plan" ? "initiative" : "action",
      title,
      budgets: delegatedProfile.budgets,
    },
    createdFromSessionKey: input.createdFromSessionKey,
  });

  await workboard.appendEvent({
    scope,
    work_item_id: workItem.work_item_id,
    kind: "intake.mode_selected",
    payload_json: {
      mode: input.mode,
      reason_code: input.reason_code,
      delegated_execution_profile: delegatedProfileId,
    },
  });

  const quota = input.executionProfile.profile.quotas?.max_running_subagents;
  if (quota !== undefined) {
    const { subagents } = await workboard.listSubagents({
      scope,
      statuses: ["running"],
      limit: 200,
    });
    if (subagents.length >= quota) {
      return {
        reply:
          `Delegated to WorkItem ${workItem.work_item_id} (mode=${input.mode}). ` +
          `Spawn quota reached (${String(subagents.length)}/${String(quota)}); no subagent spawned.`,
        work_item_id: workItem.work_item_id,
      };
    }
  }

  const subagentId = randomUUID();
  const sessionKey = (() => {
    if (!input.createdFromSessionKey.startsWith("agent:")) {
      return `agent:${deps.agentId}:subagent:${subagentId}`;
    }
    const agentKey = input.createdFromSessionKey.split(":")[1]?.trim();
    const normalized = agentKey && agentKey.length > 0 ? agentKey : deps.agentId;
    return `agent:${normalized}:subagent:${subagentId}`;
  })();
  const subagent = await workboard.createSubagent({
    scope,
    subagent: {
      execution_profile: delegatedProfileId,
      session_key: sessionKey,
      lane: "subagent",
      status: "running",
      work_item_id: workItem.work_item_id,
    },
    subagentId,
  });

  return {
    reply:
      `Delegated to WorkItem ${workItem.work_item_id} (mode=${input.mode}, reason=${input.reason_code}). ` +
      `Spawned subagent ${subagent.subagent_id} (profile=${subagent.execution_profile}).`,
    work_item_id: workItem.work_item_id,
    subagent_id: subagent.subagent_id,
  };
}

export async function handleIntakeModeDecision(
  deps: { container: GatewayContainer },
  input: {
    resolved: ResolvedAgentTurnInput;
    workScope: WorkScope;
  },
): Promise<{ reply: string; work_item_id: string } | undefined> {
  const intakeModeDecision = parseIntakeModeDecision(input.resolved.message);
  if (!intakeModeDecision) return undefined;

  const createdFromSessionKeyRaw = input.resolved.metadata?.["work_session_key"];
  const createdFromSessionKey =
    typeof createdFromSessionKeyRaw === "string" ? createdFromSessionKeyRaw.trim() : "";
  if (!createdFromSessionKey) {
    throw new Error("missing work_session_key metadata for delegated work");
  }

  const workboard = new WorkboardDal(
    deps.container.db,
    deps.container.redactionEngine,
  );
  const title = deriveWorkItemTitle(intakeModeDecision.body);
  const kind = intakeModeDecision.mode === "delegate_plan" ? "initiative" : "action";

  const item = await workboard.createItem({
    scope: input.workScope,
    createdFromSessionKey,
    item: {
      kind,
      title,
      acceptance: {
        mode: intakeModeDecision.mode,
        reason_code: intakeModeDecision.reason_code,
        request: intakeModeDecision.body,
        source: { channel: input.resolved.channel, thread_id: input.resolved.thread_id },
      },
    },
  });

  await workboard.setStateKv({
    scope: { kind: "agent", ...input.workScope },
    key: "work.active_work_item_id",
    value_json: item.work_item_id,
    provenance_json: {
      source: "agent-turn",
      mode: intakeModeDecision.mode,
      reason_code: intakeModeDecision.reason_code,
    },
  });

  await workboard.setStateKv({
    scope: { kind: "work_item", ...input.workScope, work_item_id: item.work_item_id },
    key: "work.intake",
    value_json: { mode: intakeModeDecision.mode, reason_code: intakeModeDecision.reason_code },
  });

  await workboard.createTask({
    scope: input.workScope,
    task: {
      work_item_id: item.work_item_id,
      status: "queued",
      execution_profile: intakeModeDecision.mode === "delegate_plan" ? "planner" : "executor",
      side_effect_class: "workspace",
    },
  });

  await workboard.transitionItem({
    scope: input.workScope,
    work_item_id: item.work_item_id,
    status: "ready",
  });
  try {
    await workboard.transitionItem({
      scope: input.workScope,
      work_item_id: item.work_item_id,
      status: "doing",
    });
  } catch {
    // Intentional: best-effort transition to "doing"; the WorkItem still exists for operator triage.
  }

  return {
    reply: `Delegated work item created: ${item.work_item_id} (mode=${intakeModeDecision.mode}, reason=${intakeModeDecision.reason_code})`,
    work_item_id: item.work_item_id,
  };
}
