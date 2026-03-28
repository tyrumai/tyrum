import { randomUUID } from "node:crypto";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  NormalizedContainerKind,
  WorkScope,
} from "@tyrum/contracts";
import { AgentTurnRequest, SubagentConversationKey } from "@tyrum/contracts";
import type { StepExecutor } from "../../execution/engine.js";
import { ConversationQueueInterruptError } from "../../conversation-queue/queue-signal-dal.js";
import { readRecordString } from "../../util/coerce.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";
import { loadTurnFailureFromRun, loadTurnResultFromRun } from "./turn-engine-bridge-run-state.js";
import type { TurnEngineBridgeDeps, TurnExecutionContext } from "./turn-engine-bridge.js";
import {
  normalizeInternalTurnRequestIfNeeded,
  normalizeInternalTurnRequestUnknown,
} from "./turn-request-normalization.js";
import { buildAgentTurnKey } from "../turn-key.js";

export type RunStatusRow = {
  status: string;
  paused_reason: string | null;
  paused_detail: string | null;
};

type PreparedTurnExecution = {
  deadlineMs: number;
  key: string;
  runId: string;
  startMs: number;
  workerId: string;
};

type ExecuteTurnFn = (
  input: AgentTurnRequestT,
  opts: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
) => Promise<AgentTurnResponseT>;

export async function prepareTurnExecution(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): Promise<PreparedTurnExecution> {
  const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
  const resolvedInput = deps.resolveAgentTurnInput(normalizedInput);
  const tenantKey = normalizedInput.tenant_key?.trim();
  const agentKey = normalizedInput.agent_key?.trim() || deps.agentKey;
  const workspaceKey = normalizedInput.workspace_key?.trim() || deps.workspaceKey;
  const containerKind: NormalizedContainerKind =
    normalizedInput.container_kind ?? resolvedInput.envelope?.container.kind ?? "channel";
  const defaultKey = buildAgentTurnKey({
    agentId: agentKey,
    workspaceId: workspaceKey,
    channel: resolvedInput.channel,
    containerKind,
    threadId: resolvedInput.thread_id,
    deliveryAccount: resolvedInput.envelope?.delivery.account,
  });
  const queueTarget = deps.resolveConversationQueueTarget(resolvedInput.metadata);
  const automation = resolveAutomationMetadata(resolvedInput.metadata);
  const canOverride =
    queueTarget &&
    queueTarget.key.startsWith(`agent:${agentKey}:subagent:`) &&
    SubagentConversationKey.safeParse(queueTarget.key).success;
  const key = canOverride ? queueTarget.key : defaultKey;
  const planId = `agent-turn-${agentKey}-${randomUUID()}`;
  const requestId = deps.resolveTurnRequestId(normalizedInput);
  const attachmentUpdatedAtMs = Date.now();
  const sourceClientDeviceId = readRecordString(resolvedInput.metadata, "source_client_device_id");
  const attachedNodeId = readRecordString(resolvedInput.metadata, "attached_node_id");
  let attachmentTenantId = deps.tenantId;

  if (!canOverride) {
    try {
      const scopeIds = await deps.identityScopeDal.resolveScopeIds({
        ...(tenantKey ? { tenantKey } : {}),
        agentKey,
        workspaceKey,
      });
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

  const stepArgs: Record<string, unknown> = {
    channel: resolvedInput.channel,
    thread_id: resolvedInput.thread_id,
    container_kind: containerKind,
    parts: resolvedInput.parts,
    envelope: resolvedInput.envelope,
    ...(tenantKey ? { tenant_key: tenantKey } : {}),
    agent_key: agentKey,
    workspace_key: workspaceKey,
  };
  stepArgs["metadata"] = {
    ...(normalizedInput.metadata as Record<string, unknown> | undefined),
    work_conversation_key: key,
  };
  const conversation = await deps.db.get<{ conversation_id: string }>(
    `SELECT conversation_id AS conversation_id
       FROM conversations
       WHERE tenant_id = ? AND conversation_key = ?
       LIMIT 1`,
    [deps.tenantId, key],
  );

  const { runId } = await deps.executionEngine.enqueuePlan({
    tenantId: deps.tenantId,
    key,
    conversationId: conversation?.conversation_id,
    workspaceKey,
    planId,
    requestId,
    budgets: executionProfile.profile.budgets,
    steps: [{ type: "Decide", args: stepArgs }],
  });
  const startMs = Date.now();

  return {
    deadlineMs: startMs + deps.turnEngineWaitMs,
    key,
    runId,
    startMs,
    workerId: `${deps.executionWorkerId}-${runId}`,
  };
}

export function createTurnExecutor(
  deps: TurnEngineBridgeDeps,
  input: {
    deadlineMs: number;
    executeTurn: ExecuteTurnFn;
    runId: string;
  },
): {
  executor: StepExecutor;
  getConversationQueueInterrupted: () => boolean;
  getConversationQueueInterruptReason: () => string | undefined;
} {
  let queueInterrupted = false;
  let queueInterruptReason: string | undefined;

  const executor: StepExecutor = {
    execute: async (action, stepPlanId, stepIndex, timeoutMs, _context) => {
      if (action.type !== "Decide") {
        return { success: false, error: `unsupported action type: ${action.type}` };
      }

      const parsed = AgentTurnRequest.safeParse(
        normalizeInternalTurnRequestUnknown(action.args ?? {}),
      );
      if (!parsed.success) {
        return { success: false, error: `invalid agent turn request: ${parsed.error.message}` };
      }

      const remainingMs = Math.max(1, input.deadlineMs - Date.now());
      const normalizedTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : remainingMs;
      const requestedTimeoutMs = Math.max(1, Math.floor(normalizedTimeoutMs));
      const effectiveTimeoutMs = Math.min(requestedTimeoutMs, remainingMs);

      const stepRow = await deps.db.get<{
        step_id: string;
        approval_id: string | null;
      }>(
        `SELECT step_id, approval_id
           FROM execution_steps
           WHERE turn_id = ? AND step_index = ?`,
        [input.runId, stepIndex],
      );
      if (!stepRow) {
        return {
          success: false,
          error: `execution step ${String(stepIndex)} not found for run ${input.runId}`,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
      try {
        const response = await input.executeTurn(parsed.data, {
          abortSignal: controller.signal,
          timeoutMs: effectiveTimeoutMs,
          execution: {
            planId: stepPlanId,
            runId: input.runId,
            stepIndex,
            stepId: stepRow.step_id,
            stepApprovalId: stepRow.approval_id ?? undefined,
          },
        });
        return { success: true, result: response };
      } catch (err) {
        if (deps.isToolExecutionApprovalRequiredError(err)) {
          return { success: true, pause: err.pause };
        }
        if (controller.signal.aborted) {
          return { success: false, error: `timed out after ${String(effectiveTimeoutMs)}ms` };
        }
        if (err instanceof ConversationQueueInterruptError) {
          queueInterrupted = true;
          queueInterruptReason = err.message;
          await deps.executionEngine.cancelRun(input.runId, err.message);
          return { success: false, error: err.message };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      } finally {
        clearTimeout(timer);
      }
    },
  };

  return {
    executor,
    getConversationQueueInterrupted: () => queueInterrupted,
    getConversationQueueInterruptReason: () => queueInterruptReason,
  };
}

export async function resolveIfTerminal(
  deps: TurnEngineBridgeDeps,
  input: {
    getConversationQueueInterrupted: () => boolean;
    getConversationQueueInterruptReason: () => string | undefined;
    runId: string;
  },
  row: RunStatusRow,
): Promise<AgentTurnResponseT | undefined> {
  if (row.status === "succeeded") {
    const persisted = await loadTurnResultFromRun(deps, input.runId);
    if (persisted) {
      return persisted;
    }
    throw new Error("execution engine turn completed without a result payload");
  }

  if (row.status === "failed") {
    const failure = await loadTurnFailureFromRun(deps, input.runId);
    const reason =
      failure ?? row.paused_detail ?? row.paused_reason ?? `execution run ${row.status}`;
    throw new Error(reason);
  }

  if (row.status === "cancelled") {
    if (input.getConversationQueueInterrupted()) {
      throw new ConversationQueueInterruptError(input.getConversationQueueInterruptReason());
    }
    const failure = await loadTurnFailureFromRun(deps, input.runId);
    const reason =
      row.paused_detail ?? row.paused_reason ?? failure ?? `execution run ${row.status}`;
    throw new Error(reason);
  }

  if (row.status === "paused") {
    return undefined;
  }

  return undefined;
}

export async function cleanupTurnExecutionTimeout(
  deps: TurnEngineBridgeDeps,
  input: {
    key: string;
    runId: string;
    workerId: string;
  },
): Promise<void> {
  try {
    const scope = await deps.db.get<{ tenant_id: string; workspace_id: string }>(
      `SELECT tenant_id, workspace_id
         FROM turns
         WHERE turn_id = ?`,
      [input.runId],
    );
    if (!scope) {
      return;
    }
    await deps.db.run(
      `DELETE FROM conversation_leases
         WHERE tenant_id = ? AND conversation_key = ? AND lease_owner = ?`,
      [scope.tenant_id, input.key, input.workerId],
    );
    await deps.db.run(
      `DELETE FROM workspace_leases
         WHERE tenant_id = ? AND workspace_id = ? AND lease_owner = ?`,
      [scope.tenant_id, scope.workspace_id, input.workerId],
    );
  } catch {
    // Intentional: ignore best-effort cleanup failures.
  }
}
