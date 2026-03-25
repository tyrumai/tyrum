import type { WorkItemState, WorkScope } from "@tyrum/contracts";
import type { WorkboardLogger } from "./types.js";

type TransitionItemRepository = {
  transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<unknown>;
};

export async function transitionItemWithWarning(params: {
  repository: TransitionItemRepository;
  logger?: WorkboardLogger;
  scope: WorkScope;
  workItemId: string;
  status: WorkItemState;
  reason: string;
  context: string;
}): Promise<void> {
  try {
    await params.repository.transitionItem({
      scope: params.scope,
      work_item_id: params.workItemId,
      status: params.status,
      reason: params.reason,
    });
  } catch (error) {
    params.logger?.warn("workboard.transition_item_failed", {
      context: params.context,
      tenant_id: params.scope.tenant_id,
      agent_id: params.scope.agent_id,
      workspace_id: params.scope.workspace_id,
      work_item_id: params.workItemId,
      status: params.status,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
