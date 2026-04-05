import type { ActionPrimitive, CapabilityDescriptor, WsRequestEnvelope } from "@tyrum/contracts";
import { DispatchRecordDal } from "../../app/modules/node/dispatch-record-dal.js";
import type { ProtocolDeps } from "./types.js";

export type DispatchScope = {
  tenantId: string;
  turnId?: string | null;
  turnItemId?: string | null;
  workflowRunStepId?: string | null;
  policySnapshotId?: string | null;
};

export type DispatchResult = {
  taskId: string;
  dispatchId: string;
};

type PreparedDispatch = {
  taskId: string;
  dispatchId: string;
  message: WsRequestEnvelope;
};

export type PolicyDispatchState = {
  policySnapshotId?: string;
  nodeDispatchAllowed: boolean;
  trace?: { policy_snapshot_id?: string; policy_decision?: string };
};

export function hasCapability(
  capabilities: readonly CapabilityDescriptor[],
  capabilityId: string,
): boolean {
  return capabilities.some((capability) => capability.id === capabilityId);
}

export async function resolvePolicyDispatchState(
  deps: ProtocolDeps,
  toolId: string,
  toolMatchTarget: string,
  policyEnabled: boolean,
  policyEvalPromise:
    | Promise<{ decision: string; policy_snapshot?: { policy_snapshot_id?: string } }>
    | undefined,
): Promise<PolicyDispatchState> {
  const policyEvaluation = policyEvalPromise
    ? await policyEvalPromise.catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("policy.evaluate_failed", {
          tool_id: toolId,
          tool_match_target: toolMatchTarget,
          error: message,
        });
        return { decision: "deny" as const, policy_snapshot: undefined };
      })
    : undefined;
  const policyDecision = policyEvaluation?.decision;
  const policySnapshotId = policyEvaluation?.policy_snapshot?.policy_snapshot_id;
  const shouldEnforcePolicy = policyEnabled && !(deps.policyService?.isObserveOnly() ?? false);
  return {
    policySnapshotId,
    nodeDispatchAllowed: !shouldEnforcePolicy || policyDecision !== "deny",
    trace:
      policySnapshotId || policyDecision
        ? {
            policy_snapshot_id: policySnapshotId,
            policy_decision: policyDecision,
          }
        : undefined,
  };
}

async function prepareDispatch(
  deps: ProtocolDeps,
  scope: DispatchScope,
  input: {
    action: ActionPrimitive;
    capability: string;
    requestedNodeId?: string;
    selectedNodeId: string;
    connectionId: string;
    edgeId?: string;
    policySnapshotId?: string;
    trace?: { policy_snapshot_id?: string; policy_decision?: string };
  },
): Promise<PreparedDispatch> {
  const taskId = `task-${crypto.randomUUID()}`;
  const dispatchId = crypto.randomUUID();
  const message: WsRequestEnvelope = {
    request_id: taskId,
    type: "task.execute",
    payload: {
      ...(scope.turnId ? { turn_id: scope.turnId } : {}),
      dispatch_id: dispatchId,
      action: input.action,
    },
    trace: input.trace,
  };

  if (deps.db) {
    await new DispatchRecordDal(deps.db).create({
      tenantId: scope.tenantId,
      dispatchId,
      capability: input.capability,
      action: input.action,
      taskId,
      turnId: scope.turnId ?? null,
      turnItemId: scope.turnItemId ?? null,
      workflowRunStepId: scope.workflowRunStepId ?? null,
      requestedNodeId: input.requestedNodeId ?? null,
      selectedNodeId: input.selectedNodeId,
      policySnapshotId: input.policySnapshotId ?? scope.policySnapshotId ?? null,
      connectionId: input.connectionId,
      edgeId: input.edgeId,
    });
  }

  return { taskId, dispatchId, message };
}

export async function persistDispatchAndSend<T extends DispatchResult>(
  deps: ProtocolDeps,
  scope: DispatchScope,
  preparedInput: {
    action: ActionPrimitive;
    capability: string;
    requestedNodeId?: string;
    selectedNodeId: string;
    connectionId: string;
    edgeId?: string;
    policySnapshotId?: string;
    trace?: { policy_snapshot_id?: string; policy_decision?: string };
  },
  send: (prepared: DispatchResult & { message: WsRequestEnvelope }) => Promise<T>,
): Promise<T> {
  const prepared = await prepareDispatch(deps, scope, preparedInput);

  try {
    return await send(prepared);
  } catch (error) {
    if (deps.db) {
      try {
        await new DispatchRecordDal(deps.db).completeByTaskId({
          tenantId: scope.tenantId,
          taskId: prepared.taskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (completionError) {
        deps.logger?.warn("node.dispatch_record.mark_failed_failed", {
          tenant_id: scope.tenantId,
          task_id: prepared.taskId,
          dispatch_id: prepared.dispatchId,
          error:
            completionError instanceof Error ? completionError.message : String(completionError),
        });
      }
    }
    throw error;
  }
}
