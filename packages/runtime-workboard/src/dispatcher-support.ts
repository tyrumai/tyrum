import { randomUUID } from "node:crypto";
import type { SubagentDescriptor, WorkItem, WorkItemTask, WorkScope } from "@tyrum/contracts";
import { maybeFinalizeWorkItem } from "./orchestration-support.js";
import { SubagentService } from "./subagent-service.js";
import { isTerminalTaskState } from "./task-helpers.js";
import { transitionItemWithWarning } from "./transition-item-with-warning.js";
import type {
  ManagedDesktopProvisioner,
  WorkboardDispatcherRepository,
  WorkboardLogger,
  WorkboardSubagentRuntime,
} from "./types.js";

export async function prepareExecutionSubagent(params: {
  repository: WorkboardDispatcherRepository;
  runtime: WorkboardSubagentRuntime;
  subagents: SubagentService;
  desktopProvisioner?: ManagedDesktopProvisioner;
  scope: WorkScope;
  item: WorkItem;
  task: WorkItemTask;
}): Promise<{
  subagent: SubagentDescriptor;
  attachedNodeId?: string;
  reusedPausedSubagent: boolean;
}> {
  const pausedSubagents = await params.repository.listSubagents({
    scope: params.scope,
    work_item_id: params.item.work_item_id,
    work_item_task_id: params.task.task_id,
    statuses: ["paused"],
    limit: 1,
  });
  const pausedSubagent = pausedSubagents.subagents.at(0);
  const needsDesktop =
    (
      await params.repository.getStateKv({
        scope: { kind: "work_item", ...params.scope, work_item_id: params.item.work_item_id },
        key: "work.execution.needs_desktop",
      })
    )?.value_json === true;

  if (pausedSubagent) {
    let reusableSubagent = pausedSubagent;
    if (needsDesktop && !pausedSubagent.attached_node_id && params.desktopProvisioner) {
      const attachment = await params.desktopProvisioner.provisionManagedDesktop({
        tenantId: params.scope.tenant_id,
        subagentConversationKey: pausedSubagent.conversation_key,
        label: `executor:${params.item.work_item_id}`,
      });
      reusableSubagent =
        (await params.repository.updateSubagent({
          scope: params.scope,
          subagent_id: pausedSubagent.subagent_id,
          patch: {
            desktop_environment_id: attachment?.desktopEnvironmentId,
            attached_node_id: attachment?.attachedNodeId,
          },
        })) ?? pausedSubagent;
    }
    const runningSubagent =
      (await params.repository.updateSubagent({
        scope: params.scope,
        subagent_id: reusableSubagent.subagent_id,
        patch: { status: "running" },
      })) ?? reusableSubagent;
    return {
      subagent: runningSubagent,
      attachedNodeId: runningSubagent.attached_node_id,
      reusedPausedSubagent: true,
    };
  }

  const subagentId = randomUUID();
  const conversationKey = await params.runtime.buildConversationKey(params.scope, subagentId);
  const attachment =
    needsDesktop && params.desktopProvisioner
      ? await params.desktopProvisioner.provisionManagedDesktop({
          tenantId: params.scope.tenant_id,
          subagentConversationKey: conversationKey,
          label: `executor:${params.item.work_item_id}`,
        })
      : undefined;

  const subagent = await params.subagents.createSubagent({
    scope: params.scope,
    subagentId,
    subagent: {
      parent_conversation_key: params.item.created_from_conversation_key,
      work_item_id: params.item.work_item_id,
      work_item_task_id: params.task.task_id,
      execution_profile:
        params.task.execution_profile === "integrator"
          ? "executor_rw"
          : params.task.execution_profile,
      conversation_key: conversationKey,
      status: "running",
      desktop_environment_id: attachment?.desktopEnvironmentId,
      attached_node_id: attachment?.attachedNodeId,
    },
  });

  return {
    subagent,
    attachedNodeId: attachment?.attachedNodeId,
    reusedPausedSubagent: false,
  };
}

export async function reconcileItemDispatchState(params: {
  repository: WorkboardDispatcherRepository;
  logger?: WorkboardLogger;
  scope: WorkScope;
  workItemId: string;
}): Promise<void> {
  const item = await params.repository.getItem({
    scope: params.scope,
    work_item_id: params.workItemId,
  });
  if (!item || item.status === "cancelled" || item.status === "failed" || item.status === "done") {
    return;
  }

  const tasks = (
    await params.repository.listTasks({ scope: params.scope, work_item_id: params.workItemId })
  ).filter((task) => task.execution_profile !== "planner");
  if (tasks.length === 0) {
    return;
  }

  if (tasks.every((task) => task.status === "completed" || task.status === "skipped")) {
    await params.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
      key: "work.dispatch.phase",
      value_json: "done",
      provenance_json: { source: "workboard.dispatcher" },
    });
    await maybeFinalizeWorkItem({
      repository: params.repository,
      scope: params.scope,
      workItemId: params.workItemId,
    });
    return;
  }

  if (tasks.some((task) => task.status === "failed")) {
    await params.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
      key: "work.dispatch.phase",
      value_json: "blocked",
      provenance_json: { source: "workboard.dispatcher" },
    });
    if (item.status === "doing") {
      await transitionItemWithWarning({
        repository: params.repository,
        logger: params.logger,
        scope: params.scope,
        workItemId: params.workItemId,
        status: "blocked",
        reason: "Execution task failed.",
        context: "dispatch_state_failed_task",
      });
    }
    return;
  }

  if (tasks.some((task) => task.status === "paused")) {
    await params.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "workboard.dispatcher" },
    });
    if (item.status === "doing") {
      await transitionItemWithWarning({
        repository: params.repository,
        logger: params.logger,
        scope: params.scope,
        workItemId: params.workItemId,
        status: "blocked",
        reason: "Execution paused pending human action.",
        context: "dispatch_state_paused_task",
      });
    }
    return;
  }

  if (tasks.some((task) => task.status === "running")) {
    await params.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
      key: "work.dispatch.phase",
      value_json: "running",
      provenance_json: { source: "workboard.dispatcher" },
    });
    return;
  }

  if (tasks.some((task) => task.status === "queued" || task.status === "leased")) {
    await params.repository.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "workboard.dispatcher" },
    });
    if (item.status === "doing" || item.status === "blocked") {
      await transitionItemWithWarning({
        repository: params.repository,
        logger: params.logger,
        scope: params.scope,
        workItemId: params.workItemId,
        status: "ready",
        reason: "Execution work is ready for dispatch.",
        context: "dispatch_state_queued_task",
      });
    }
  }
}

export async function requeueLeasedTask(params: {
  repository: WorkboardDispatcherRepository;
  scope: WorkScope;
  taskId: string;
  leaseOwner: string;
}): Promise<void> {
  await params.repository.updateTask({
    scope: params.scope,
    task_id: params.taskId,
    lease_owner: params.leaseOwner,
    patch: { status: "queued" },
  });
}

export async function ensureExecutionTask(params: {
  repository: WorkboardDispatcherRepository;
  scope: WorkScope;
  workItemId: string;
}): Promise<void> {
  const tasks = await params.repository.listTasks({
    scope: params.scope,
    work_item_id: params.workItemId,
  });
  const executionTasks = tasks.filter((task) => task.execution_profile !== "planner");
  if (executionTasks.some((task) => !isTerminalTaskState(task.status))) {
    return;
  }

  const hasSuccessfulExecutionTask = executionTasks.some(
    (task) => task.status === "completed" || task.status === "skipped",
  );
  if (executionTasks.length > 0 && hasSuccessfulExecutionTask) {
    return;
  }

  await params.repository.createTask({
    scope: params.scope,
    task: {
      work_item_id: params.workItemId,
      status: "queued",
      execution_profile: "executor_rw",
      side_effect_class: "workspace",
      result_summary: "Default execution task",
    },
  });
}
