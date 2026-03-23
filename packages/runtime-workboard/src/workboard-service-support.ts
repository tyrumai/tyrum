import type { SubagentDescriptor, WorkScope } from "@tyrum/contracts";
import type { WorkboardServiceEffects, WorkboardServiceRepository } from "./types.js";

export interface WorkboardServiceDeps {
  repository: WorkboardServiceRepository;
  effects?: WorkboardServiceEffects;
}

export async function assertItemMutable(
  repository: WorkboardServiceRepository,
  scope: WorkScope,
  workItemId: string,
): Promise<void> {
  const [subagents, tasks] = await Promise.all([
    listSubagents(repository, scope, workItemId, ["running", "closing"]),
    repository.listTaskRows({
      scope,
      work_item_id: workItemId,
    }),
  ]);

  if (
    subagents.length > 0 ||
    tasks.some((task) => task.status === "leased" || task.status === "running")
  ) {
    throw new Error("work item is read-only while actively leased to an agent");
  }
}

export async function listSubagents(
  repository: WorkboardServiceRepository,
  scope: WorkScope,
  workItemId: string,
  statuses: Array<SubagentDescriptor["status"]>,
): Promise<SubagentDescriptor[]> {
  return (
    await repository.listSubagents({
      scope,
      work_item_id: workItemId,
      statuses,
      limit: 200,
    })
  ).subagents;
}

export async function closeSubagents(params: {
  repository: WorkboardServiceRepository;
  effects?: WorkboardServiceEffects;
  scope: WorkScope;
  subagents: SubagentDescriptor[];
  reason: string;
  occurredAtIso?: string;
  clearSignals?: boolean;
}): Promise<void> {
  if (params.subagents.length === 0) {
    return;
  }

  if (params.clearSignals) {
    await params.effects?.clearSubagentSignals?.({
      subagents: params.subagents,
    });
  }

  for (const subagent of params.subagents) {
    const closeParams: Parameters<WorkboardServiceRepository["closeSubagent"]>[0] = {
      scope: params.scope,
      subagent_id: subagent.subagent_id,
      reason: params.reason,
    };
    if (params.occurredAtIso) {
      closeParams.closedAtIso = params.occurredAtIso;
    }
    await params.repository.closeSubagent(closeParams);

    const markClosedParams: Parameters<WorkboardServiceRepository["markSubagentClosed"]>[0] = {
      scope: params.scope,
      subagent_id: subagent.subagent_id,
    };
    if (params.occurredAtIso) {
      markClosedParams.closedAtIso = params.occurredAtIso;
    }
    await params.repository.markSubagentClosed(markClosedParams);
  }
}

export async function cancelPausedTasks(params: {
  repository: WorkboardServiceRepository;
  scope: WorkScope;
  workItemId: string;
  detail: string;
  occurredAtIso?: string;
}): Promise<void> {
  const tasks = await params.repository.listTaskRows({
    scope: params.scope,
    work_item_id: params.workItemId,
  });

  for (const task of tasks.filter((entry) => entry.status === "paused")) {
    const updateParams: Parameters<WorkboardServiceRepository["updateTask"]>[0] = {
      scope: params.scope,
      task_id: task.task_id,
      patch: {
        status: "cancelled",
        approval_id: null,
        result_summary: params.detail,
      },
    };

    if (params.occurredAtIso) {
      updateParams.patch.finished_at = params.occurredAtIso;
      updateParams.updatedAtIso = params.occurredAtIso;
    }

    await params.repository.updateTask(updateParams);
  }
}

export async function teardownActiveExecution(params: {
  repository: WorkboardServiceRepository;
  effects?: WorkboardServiceEffects;
  scope: WorkScope;
  workItemId: string;
  reason: string;
  occurredAtIso: string;
}): Promise<void> {
  const parsedOccurredAtMs = Date.parse(params.occurredAtIso);
  const occurredAtMs = Number.isFinite(parsedOccurredAtMs) ? parsedOccurredAtMs : Date.now();
  const [subagents, tasks] = await Promise.all([
    listSubagents(params.repository, params.scope, params.workItemId, ["running", "closing"]),
    params.repository.listTaskRows({
      scope: params.scope,
      work_item_id: params.workItemId,
    }),
  ]);
  const activeTasks = tasks.filter((task) => task.status === "leased" || task.status === "running");

  await params.effects?.interruptSubagents?.({
    subagents,
    detail: params.reason,
    createdAtMs: occurredAtMs,
  });

  for (const task of activeTasks) {
    if (task.status === "leased" && !task.lease_owner) {
      throw new Error(`leased task ${task.task_id} is missing lease owner`);
    }

    const updateParams: Parameters<WorkboardServiceRepository["updateTask"]>[0] = {
      scope: params.scope,
      task_id: task.task_id,
      patch: {
        status: "cancelled",
        approval_id: null,
        finished_at: params.occurredAtIso,
        result_summary: params.reason,
      },
      updatedAtIso: params.occurredAtIso,
    };

    if (task.status === "leased") {
      updateParams.lease_owner = task.lease_owner ?? undefined;
      updateParams.nowMs = occurredAtMs;
      updateParams.allowExpiredLeaseRelease = true;
    }

    await params.repository.updateTask(updateParams);
  }

  await closeSubagents({
    repository: params.repository,
    effects: params.effects,
    scope: params.scope,
    subagents,
    reason: params.reason,
    occurredAtIso: params.occurredAtIso,
  });
}
