import { randomUUID } from "node:crypto";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
  WorkScope,
} from "@tyrum/contracts";
import { SubagentConversationKey } from "@tyrum/contracts";
import { readRecordString } from "../../util/coerce.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";
import { normalizeInternalTurnRequestIfNeeded } from "./turn-request-normalization.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import { buildAgentTurnKey } from "../turn-key.js";
import { withNativeTurnRunnerInputMarker } from "./turn-runner-native-marker.js";

type PreparedTurnExecution = {
  planId: string;
  deadlineMs: number;
  key: string;
  turnId: string;
  startMs: number;
  workerId: string;
};

type PrepareConversationTurnRunInput = {
  prepared?: PreparedConversationTurnContext;
  steps: Array<{ type: string; args?: Record<string, unknown> }>;
};

type PreparedConversationTurnContext = {
  normalizedInput: AgentTurnRequestT;
  resolvedInput: ResolvedAgentTurnInput;
  tenantKey?: string;
  agentKey: string;
  workspaceKey: string;
  containerKind: NormalizedContainerKind;
  queueTarget?: { key: string };
  key: string;
  canOverride: boolean;
};

async function resolvePreparedScopeIds(
  deps: Pick<TurnEngineBridgeDeps, "tenantId" | "identityScopeDal">,
  input: {
    tenantKey?: string;
    agentKey: string;
    workspaceKey: string;
  },
) {
  if (input.tenantKey) {
    return await deps.identityScopeDal.resolveScopeIds({
      tenantKey: input.tenantKey,
      agentKey: input.agentKey,
      workspaceKey: input.workspaceKey,
    });
  }

  const agentId = await deps.identityScopeDal.ensureAgentId(deps.tenantId, input.agentKey);
  const workspaceId = await deps.identityScopeDal.ensureWorkspaceId(
    deps.tenantId,
    input.workspaceKey,
  );
  await deps.identityScopeDal.ensureMembership(deps.tenantId, agentId, workspaceId);
  return {
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
  };
}

function resolvePreparedConversationKey(input: {
  agentKey: string;
  workspaceKey: string;
  channel: string;
  threadId: string;
  containerKind: NormalizedContainerKind;
  deliveryAccount?: string;
  queueTarget?: { key: string };
}): {
  key: string;
  canOverride: boolean;
} {
  const defaultKey = buildAgentTurnKey({
    agentId: input.agentKey,
    workspaceId: input.workspaceKey,
    channel: input.channel,
    containerKind: input.containerKind,
    threadId: input.threadId,
    deliveryAccount: input.deliveryAccount,
  });
  const canOverride = Boolean(
    input.queueTarget &&
    input.queueTarget.key.startsWith(`agent:${input.agentKey}:subagent:`) &&
    SubagentConversationKey.safeParse(input.queueTarget.key).success,
  );
  const key = canOverride && input.queueTarget ? input.queueTarget.key : defaultKey;

  return {
    key,
    canOverride,
  };
}

function prepareConversationTurnContext(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): PreparedConversationTurnContext {
  const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
  const resolvedInput = deps.resolveAgentTurnInput(normalizedInput);
  const tenantKey = normalizedInput.tenant_key?.trim();
  const agentKey = normalizedInput.agent_key?.trim() || deps.agentKey;
  const workspaceKey = normalizedInput.workspace_key?.trim() || deps.workspaceKey;
  const containerKind: NormalizedContainerKind =
    normalizedInput.container_kind ?? resolvedInput.envelope?.container.kind ?? "channel";
  const queueTarget = deps.resolveConversationQueueTarget(resolvedInput.metadata);
  const { key, canOverride } = resolvePreparedConversationKey({
    agentKey,
    workspaceKey,
    channel: resolvedInput.channel,
    threadId: resolvedInput.thread_id,
    containerKind,
    deliveryAccount: resolvedInput.envelope?.delivery.account,
    queueTarget,
  });

  return {
    normalizedInput,
    resolvedInput,
    tenantKey,
    agentKey,
    workspaceKey,
    containerKind,
    queueTarget,
    key,
    canOverride,
  };
}

export async function prepareConversationTurnRun(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
  options: PrepareConversationTurnRunInput,
): Promise<PreparedTurnExecution> {
  const prepared = options.prepared ?? prepareConversationTurnContext(deps, input);
  const {
    normalizedInput,
    resolvedInput,
    tenantKey,
    agentKey,
    workspaceKey,
    queueTarget,
    key,
    canOverride,
  } = prepared;
  const automation = resolveAutomationMetadata(resolvedInput.metadata);
  const planId = `agent-turn-${agentKey}-${randomUUID()}`;
  const requestId = deps.resolveTurnRequestId(normalizedInput);
  const scopeIds = await resolvePreparedScopeIds(deps, {
    tenantKey,
    agentKey,
    workspaceKey,
  });
  const attachmentUpdatedAtMs = Date.now();
  const sourceClientDeviceId = readRecordString(resolvedInput.metadata, "source_client_device_id");
  const attachedNodeId = readRecordString(resolvedInput.metadata, "attached_node_id");
  let attachmentTenantId = deps.tenantId;

  if (!canOverride) {
    try {
      const workScope: WorkScope = {
        tenant_id: scopeIds.tenantId,
        agent_id: scopeIds.agentId,
        workspace_id: scopeIds.workspaceId,
      };
      attachmentTenantId = workScope.tenant_id;
      if (!automation) {
        await new WorkboardDal(deps.db).upsertScopeActivity({
          scope: workScope,
          last_active_conversation_key: key,
          updated_at_ms: attachmentUpdatedAtMs,
        });
      }
    } catch {
      // Intentional: ignore best-effort activity tracking failures.
    }
  }
  try {
    await deps.conversationNodeAttachmentDal.put({
      tenantId: attachmentTenantId,
      key,
      sourceClientDeviceId,
      attachedNodeId,
      lastActivityAtMs: attachmentUpdatedAtMs,
      updatedAtMs: attachmentUpdatedAtMs,
      createIfMissing: sourceClientDeviceId !== undefined || attachedNodeId !== undefined,
    });
  } catch {
    // Intentional: ignore best-effort activity tracking failures.
  }

  const executionProfile = await deps.resolveExecutionProfile({
    queueTarget,
    metadata: resolvedInput.metadata,
  });

  const conversation = await deps.db.get<{ conversation_id: string }>(
    `SELECT conversation_id AS conversation_id
       FROM conversations
       WHERE tenant_id = ? AND conversation_key = ?
       LIMIT 1`,
    [deps.tenantId, key],
  );

  const turnId =
    options.steps.length === 0
      ? await deps.db.transaction(async (tx) => {
          const jobId = randomUUID();
          const inputJson = JSON.stringify(
            withNativeTurnRunnerInputMarker({
              request: normalizedInput,
              plan_id: planId,
              request_id: requestId,
            }),
          );
          const triggerJson = JSON.stringify({
            kind: "conversation",
            conversation_key: key,
            metadata: {
              plan_id: planId,
              request_id: requestId,
              tenant_id: deps.tenantId,
              agent_id: scopeIds.agentId,
              workspace_id: scopeIds.workspaceId,
            },
          });
          const queuedTurnId = randomUUID();

          await tx.run(
            `INSERT INTO turn_jobs (
               tenant_id,
               job_id,
               agent_id,
               workspace_id,
               conversation_id,
               conversation_key,
               status,
               trigger_json,
               input_json,
               latest_turn_id,
               policy_snapshot_id
             )
             VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
            [
              deps.tenantId,
              jobId,
              scopeIds.agentId,
              scopeIds.workspaceId,
              conversation?.conversation_id ?? null,
              key,
              triggerJson,
              inputJson,
              queuedTurnId,
              null,
            ],
          );
          await tx.run(
            `INSERT INTO turns (
               tenant_id,
               turn_id,
               job_id,
               conversation_key,
               status,
               attempt,
               budgets_json
             )
             VALUES (?, ?, ?, ?, 'queued', 1, ?)`,
            [
              deps.tenantId,
              queuedTurnId,
              jobId,
              key,
              executionProfile.profile.budgets
                ? JSON.stringify(executionProfile.profile.budgets)
                : null,
            ],
          );
          return queuedTurnId;
        })
      : (() => {
          throw new Error("legacy execution-engine queueing is no longer supported");
        })();
  const startMs = Date.now();

  return {
    planId,
    deadlineMs: startMs + deps.turnEngineWaitMs,
    key,
    turnId,
    startMs,
    workerId: `${deps.executionWorkerId}-${turnId}`,
  };
}
