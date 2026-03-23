import type { WorkItemState } from "@tyrum/contracts";
import { WORK_ITEM_TRANSITIONS, WorkboardTransitionError } from "./transition-errors.js";
import type { WorkboardItemEventType, WorkboardServiceRepository } from "./types.js";
import {
  assertItemMutable,
  cancelPausedTasks,
  closeSubagents,
  listSubagents,
  teardownActiveExecution,
  type WorkboardServiceDeps,
} from "./workboard-service-support.js";

export async function transitionWorkItem(
  deps: WorkboardServiceDeps,
  params: Parameters<WorkboardServiceRepository["transitionItem"]>[0],
) {
  if (params.status === "cancelled") {
    return await cancelWorkItem(deps, params);
  }

  await assertItemMutable(deps.repository, params.scope, params.work_item_id);
  return await transitionWorkItemInternal(deps, params);
}

export async function transitionWorkItemSystem(
  deps: WorkboardServiceDeps,
  params: Parameters<WorkboardServiceRepository["transitionItem"]>[0],
) {
  return await transitionWorkItemInternal(deps, params);
}

async function transitionWorkItemInternal(
  deps: WorkboardServiceDeps,
  params: Parameters<WorkboardServiceRepository["transitionItem"]>[0],
) {
  const item = await deps.repository.transitionItem(params);
  if (!item) {
    return undefined;
  }

  await deps.effects?.emitItemEvent?.({
    type: getTransitionEventType(params.status),
    item,
  });
  await deps.effects?.notifyItemTransition?.({
    scope: params.scope,
    item,
  });
  return item;
}

async function cancelWorkItem(
  deps: WorkboardServiceDeps,
  params: Parameters<WorkboardServiceRepository["transitionItem"]>[0],
) {
  const item = await deps.repository.getItem({
    scope: params.scope,
    work_item_id: params.work_item_id,
  });
  if (!item) {
    return undefined;
  }

  const occurredAtIso = params.occurredAtIso ?? new Date().toISOString();
  const reason = params.reason?.trim() || "Cancelled by operator.";
  assertOperatorCancelAllowed(item.status);

  await teardownActiveExecution({
    repository: deps.repository,
    effects: deps.effects,
    scope: params.scope,
    workItemId: params.work_item_id,
    reason,
    occurredAtIso,
  });
  await deps.effects?.resolvePendingInterventionApprovals?.({
    scope: params.scope,
    work_item_id: params.work_item_id,
    decision: "denied",
    reason,
  });
  await closeSubagents({
    repository: deps.repository,
    effects: deps.effects,
    scope: params.scope,
    subagents: await listSubagents(deps.repository, params.scope, params.work_item_id, ["paused"]),
    reason,
    occurredAtIso,
    clearSignals: true,
  });
  await cancelPausedTasks({
    repository: deps.repository,
    scope: params.scope,
    workItemId: params.work_item_id,
    detail: reason,
    occurredAtIso,
  });

  return await transitionWorkItemInternal(deps, {
    ...params,
    occurredAtIso,
    reason,
  });
}

function getTransitionEventType(status: WorkItemState): WorkboardItemEventType {
  switch (status) {
    case "blocked":
      return "work.item.blocked";
    case "done":
      return "work.item.completed";
    case "failed":
      return "work.item.failed";
    case "cancelled":
      return "work.item.cancelled";
    default:
      return "work.item.updated";
  }
}

function assertOperatorCancelAllowed(from: WorkItemState): void {
  const allowed = WORK_ITEM_TRANSITIONS[from];
  if (allowed?.includes("cancelled")) {
    return;
  }

  throw new WorkboardTransitionError(
    "invalid_transition",
    { code: "invalid_transition", from, to: "cancelled", allowed },
    `invalid transition from ${from} to cancelled`,
  );
}
