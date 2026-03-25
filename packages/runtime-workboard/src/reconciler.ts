import type { WorkItemTask, WorkScope } from "@tyrum/contracts";
import { maybeFinalizeWorkItem } from "./orchestration-support.js";
import { transitionItemWithWarning } from "./transition-item-with-warning.js";
import type { WorkboardLogger, WorkboardReconcilerRepository } from "./types.js";

const ORPHAN_RETRY_KEY_PREFIX = "work.dispatch.orphan_retry";

function orphanRetryKey(taskId: string): string {
  return `${ORPHAN_RETRY_KEY_PREFIX}.${taskId}`;
}

function toRetryCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class WorkboardReconciler {
  constructor(
    private readonly opts: {
      repository: WorkboardReconcilerRepository;
      logger?: WorkboardLogger;
    },
  ) {}

  async tick(): Promise<void> {
    const items = await this.opts.repository.listDoingItems(50);
    for (const item of items) {
      await this.reconcileDoingItem(item, item.work_item_id);
    }
  }

  private async reconcileDoingItem(scope: WorkScope, workItemId: string): Promise<void> {
    const activeSubagents = await this.opts.repository.listSubagents({
      scope,
      work_item_id: workItemId,
      statuses: ["running", "paused"],
      limit: 10,
    });
    if (activeSubagents.subagents.length > 0) {
      return;
    }

    const tasks = await this.opts.repository.listTasks({ scope, work_item_id: workItemId });
    const executionTasks = tasks.filter((task) => task.execution_profile !== "planner");

    if (executionTasks.some((task) => task.status === "failed")) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "blocked",
        provenance_json: { source: "workboard.reconciler" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope,
        workItemId,
        status: "blocked",
        reason: "Execution task failed without an active subagent.",
        context: "reconcile_failed_task",
      });
      return;
    }

    if (
      executionTasks.length > 0 &&
      executionTasks.every((task) => task.status === "completed" || task.status === "skipped")
    ) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "done",
        provenance_json: { source: "workboard.reconciler" },
      });
      await maybeFinalizeWorkItem({
        repository: this.opts.repository,
        scope,
        workItemId,
      });
      return;
    }

    if (executionTasks.length === 0) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "unassigned",
        provenance_json: { source: "workboard.reconciler" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope,
        workItemId,
        status: "ready",
        reason: "Execution work is missing and must be redispatched.",
        context: "reconcile_missing_tasks",
      });
      return;
    }

    if (executionTasks.every((task) => task.status === "cancelled")) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "blocked",
        provenance_json: { source: "workboard.reconciler" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope,
        workItemId,
        status: "blocked",
        reason: "Execution work was cancelled without an active subagent.",
        context: "reconcile_cancelled_tasks",
      });
      return;
    }

    const orphanedTasks = executionTasks.filter(
      (task) => task.status === "leased" || task.status === "running" || task.status === "paused",
    );
    if (orphanedTasks.length > 0) {
      await this.handleOrphanedTasks(scope, workItemId, orphanedTasks);
      return;
    }

    const hasQueuedWork = executionTasks.some((task) => task.status === "queued");
    if (hasQueuedWork) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "unassigned",
        provenance_json: { source: "workboard.reconciler" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope,
        workItemId,
        status: "ready",
        reason: "Execution work is ready for redispatch.",
        context: "reconcile_queued_tasks",
      });
    }
  }

  private async handleOrphanedTasks(
    scope: WorkScope,
    workItemId: string,
    orphanedTasks: WorkItemTask[],
  ): Promise<void> {
    const candidate = orphanedTasks[0];
    if (!candidate) {
      return;
    }

    const retryEntry = await this.opts.repository.getStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: workItemId },
      key: orphanRetryKey(candidate.task_id),
    });
    const retryCount = toRetryCount(retryEntry?.value_json);
    const detail =
      retryCount >= 1
        ? "Work lost its active subagent after one automatic retry."
        : "Automatically requeued orphaned execution work.";

    if (retryCount >= 1) {
      const approval = await this.opts.repository.createInterventionApproval({
        scope,
        work_item_id: workItemId,
        task_id: candidate.task_id,
        reason: detail,
      });
      await this.opts.repository.requeueOrphanedTasks({
        scope,
        work_item_id: workItemId,
        updated_at: new Date().toISOString(),
      });
      await this.opts.repository.updateTask({
        scope,
        task_id: candidate.task_id,
        patch: {
          status: "paused",
          approval_id: approval?.approval_id ?? null,
          pause_reason: "orphan_retry_exhausted",
          pause_detail: detail,
          result_summary: detail,
        },
      });
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "awaiting_human",
        provenance_json: { source: "workboard.reconciler" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope,
        workItemId,
        status: "blocked",
        reason: detail,
        context: "reconcile_orphan_retry_exhausted",
      });
      return;
    }

    await this.opts.repository.requeueOrphanedTasks({
      scope,
      work_item_id: workItemId,
      updated_at: new Date().toISOString(),
    });
    for (const task of orphanedTasks) {
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: orphanRetryKey(task.task_id),
        value_json: 1,
        provenance_json: { source: "workboard.reconciler" },
      });
    }
    await this.opts.repository.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: workItemId },
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "workboard.reconciler" },
    });
    await transitionItemWithWarning({
      repository: this.opts.repository,
      logger: this.opts.logger,
      scope,
      workItemId,
      status: "ready",
      reason: detail,
      context: "reconcile_orphan_requeued",
    });
  }
}
