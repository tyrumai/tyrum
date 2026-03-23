import type { WorkScope } from "@tyrum/contracts";
import type { WorkboardServiceRepository } from "./types.js";
import {
  closeSubagents,
  cancelPausedTasks,
  listSubagents,
  teardownActiveExecution,
  type WorkboardServiceDeps,
} from "./workboard-service-support.js";
import {
  transitionWorkItem,
  transitionWorkItemSystem,
} from "./workboard-service-transition-support.js";

export async function deleteWorkItem(
  deps: WorkboardServiceDeps,
  params: Parameters<WorkboardServiceRepository["deleteItem"]>[0],
) {
  const occurredAtIso = new Date().toISOString();
  const reason = "Deleted by operator.";
  await teardownActiveExecution({
    repository: deps.repository,
    effects: deps.effects,
    scope: params.scope,
    workItemId: params.work_item_id,
    reason,
    occurredAtIso,
  });
  const deleteEffects = (await deps.effects?.loadDeleteEffects?.({
    scope: params.scope,
    work_item_id: params.work_item_id,
  })) ?? { childItemIds: [], attachedSignalIds: [] };

  await deps.effects?.resolvePendingInterventionApprovals?.({
    scope: params.scope,
    work_item_id: params.work_item_id,
    decision: "denied",
    reason: "Work deleted by operator.",
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

  for (const signalId of deleteEffects.attachedSignalIds) {
    await deps.repository.updateSignal({
      scope: params.scope,
      signal_id: signalId,
      patch: { status: "cancelled" },
    });
  }

  const item = await deps.repository.deleteItem(params);
  if (!item) {
    return undefined;
  }

  await deps.effects?.emitDeleteEffects?.({
    scope: params.scope,
    childItemIds: deleteEffects.childItemIds,
    attachedSignalIds: deleteEffects.attachedSignalIds,
  });
  await deps.effects?.emitItemEvent?.({
    type: "work.item.deleted",
    item,
  });
  return item;
}

export async function pauseWorkItem(
  deps: WorkboardServiceDeps,
  params: { scope: WorkScope; work_item_id: string; reason?: string },
) {
  const item = await deps.repository.getItem(params);
  if (!item) {
    return undefined;
  }

  const [subagents, tasks] = await Promise.all([
    listSubagents(deps.repository, params.scope, params.work_item_id, [
      "running",
      "closing",
      "paused",
    ]),
    deps.repository.listTaskRows({
      scope: params.scope,
      work_item_id: params.work_item_id,
    }),
  ]);
  const activeSubagents = subagents.filter(
    (subagent) => subagent.status === "running" || subagent.status === "closing",
  );
  const activeTasks = tasks.filter((task) => task.status === "leased" || task.status === "running");

  if (activeSubagents.length === 0 && activeTasks.length === 0) {
    if (
      subagents.some((subagent) => subagent.status === "paused") ||
      tasks.some((task) => task.status === "paused")
    ) {
      return item;
    }
    throw new Error("work item is not actively leased to an agent");
  }

  const pauseDetail = params.reason?.trim() || "Paused by operator.";
  await deps.effects?.interruptSubagents?.({
    subagents: activeSubagents,
    detail: pauseDetail,
    createdAtMs: Date.now(),
  });

  for (const subagent of activeSubagents) {
    await deps.repository.updateSubagent({
      scope: params.scope,
      subagent_id: subagent.subagent_id,
      patch: { status: "paused" },
    });
  }

  for (const task of activeTasks) {
    await deps.repository.updateTask({
      scope: params.scope,
      task_id: task.task_id,
      ...(task.lease_owner ? { lease_owner: task.lease_owner } : {}),
      patch: {
        status: "paused",
        approval_id: null,
        pause_reason: "manual",
        pause_detail: pauseDetail,
        result_summary: pauseDetail,
      },
    });
  }

  const hasPlannerOwnership =
    activeTasks.some((task) => task.execution_profile === "planner") ||
    activeSubagents.some((subagent) => subagent.execution_profile === "planner");

  if (hasPlannerOwnership) {
    await deps.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
      key: "work.refinement.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "work.pause" },
    });
    return await deps.repository.getItem(params);
  }

  await deps.repository.setStateKv({
    scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
    key: "work.dispatch.phase",
    value_json: "awaiting_human",
    provenance_json: { source: "work.pause" },
  });

  if (item.status === "doing") {
    return await transitionWorkItem(deps, {
      scope: params.scope,
      work_item_id: params.work_item_id,
      status: "blocked",
      reason: pauseDetail,
    });
  }

  return await deps.repository.getItem(params);
}

export async function resumeWorkItem(
  deps: WorkboardServiceDeps,
  params: { scope: WorkScope; work_item_id: string; reason?: string },
) {
  const item = await deps.repository.getItem(params);
  if (!item) {
    return undefined;
  }

  const [pausedSubagents, tasks] = await Promise.all([
    listSubagents(deps.repository, params.scope, params.work_item_id, ["paused"]),
    deps.repository.listTaskRows({
      scope: params.scope,
      work_item_id: params.work_item_id,
    }),
  ]);
  const pausedTasks = tasks.filter((task) => task.status === "paused");

  if (pausedTasks.length === 0 && pausedSubagents.length === 0) {
    return item;
  }

  const resumeDetail = params.reason?.trim() || "Resumed by operator.";
  await closeSubagents({
    repository: deps.repository,
    effects: deps.effects,
    scope: params.scope,
    subagents: pausedSubagents,
    reason: resumeDetail,
    clearSignals: true,
  });

  const hasPlannerOwnership =
    pausedTasks.some((task) => task.execution_profile === "planner") ||
    pausedSubagents.some((subagent) => subagent.execution_profile === "planner");

  for (const task of pausedTasks) {
    await deps.repository.updateTask({
      scope: params.scope,
      task_id: task.task_id,
      patch: {
        status: "queued",
        approval_id: null,
        pause_reason: null,
        pause_detail: null,
        result_summary: resumeDetail,
      },
    });
  }

  if (hasPlannerOwnership) {
    if (!pausedTasks.some((task) => task.execution_profile === "planner")) {
      await deps.repository.createTask({
        scope: params.scope,
        task: {
          work_item_id: params.work_item_id,
          status: "queued",
          execution_profile: "planner",
          side_effect_class: "workspace",
          result_summary: resumeDetail,
        },
      });
    }
    await deps.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
      key: "work.refinement.phase",
      value_json: "refining",
      provenance_json: { source: "work.resume" },
    });
    await deps.effects?.resolvePendingInterventionApprovals?.({
      scope: params.scope,
      work_item_id: params.work_item_id,
      decision: "approved",
      reason: resumeDetail,
    });
    return await deps.repository.getItem(params);
  }

  await deps.repository.setStateKv({
    scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
    key: "work.dispatch.phase",
    value_json: "unassigned",
    provenance_json: { source: "work.resume" },
  });

  if (!pausedTasks.some((task) => task.execution_profile !== "planner")) {
    await deps.repository.createTask({
      scope: params.scope,
      task: {
        work_item_id: params.work_item_id,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
        result_summary: resumeDetail,
      },
    });
  }

  if (item.status === "blocked") {
    const resumed = await transitionWorkItem(deps, {
      scope: params.scope,
      work_item_id: params.work_item_id,
      status: "ready",
      reason: resumeDetail,
    });
    await deps.effects?.resolvePendingInterventionApprovals?.({
      scope: params.scope,
      work_item_id: params.work_item_id,
      decision: "approved",
      reason: resumeDetail,
    });
    return resumed;
  }

  await deps.effects?.resolvePendingInterventionApprovals?.({
    scope: params.scope,
    work_item_id: params.work_item_id,
    decision: "approved",
    reason: resumeDetail,
  });
  return await deps.repository.getItem(params);
}

export async function resolveInterventionApproval(
  deps: WorkboardServiceDeps,
  params: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    work_item_id: string;
    work_item_task_id: string;
    decision: "approved" | "denied";
    reason?: string;
  },
) {
  const scope = {
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    workspace_id: params.workspaceId,
  } satisfies WorkScope;

  if (params.decision === "approved") {
    return await resumeWorkItem(deps, {
      scope,
      work_item_id: params.work_item_id,
      reason: params.reason ?? "Intervention approved.",
    });
  }

  const detail = params.reason?.trim() || "Intervention denied.";
  await closeSubagents({
    repository: deps.repository,
    effects: deps.effects,
    scope,
    subagents: await listSubagents(deps.repository, scope, params.work_item_id, ["paused"]),
    reason: detail,
    clearSignals: true,
  });
  await deps.repository.updateTask({
    scope,
    task_id: params.work_item_task_id,
    patch: {
      status: "cancelled",
      approval_id: null,
      result_summary: detail,
    },
  });
  await deps.repository.setStateKv({
    scope: { kind: "work_item", ...scope, work_item_id: params.work_item_id },
    key: "work.dispatch.phase",
    value_json: "cancelled",
    provenance_json: { source: "approval.resolve" },
  });
  const item = await deps.repository.getItem({
    scope,
    work_item_id: params.work_item_id,
  });
  if (!item) {
    return undefined;
  }
  if (item.status === "blocked" || item.status === "ready" || item.status === "doing") {
    return await transitionWorkItemSystem(deps, {
      scope,
      work_item_id: params.work_item_id,
      status: "cancelled",
      reason: detail,
    });
  }
  return item;
}
