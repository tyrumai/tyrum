import type { WorkScope } from "@tyrum/contracts";
import { maybeFinalizeWorkItem } from "./orchestration-support.js";
import type { WorkboardReconcilerRepository } from "./types.js";

export class WorkboardReconciler {
  constructor(
    private readonly opts: {
      repository: WorkboardReconcilerRepository;
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
    if (tasks.some((task) => task.status === "failed")) {
      await this.opts.repository
        .transitionItem({
          scope,
          work_item_id: workItemId,
          status: "blocked",
          reason: "Execution task failed without an active subagent.",
        })
        .catch(() => undefined);
      return;
    }

    if (
      tasks.length > 0 &&
      tasks.every((task) => task.status === "completed" || task.status === "skipped")
    ) {
      await maybeFinalizeWorkItem({
        repository: this.opts.repository,
        scope,
        workItemId,
      });
      return;
    }

    if (
      tasks.some((task) => task.status === "cancelled") &&
      tasks.every(
        (task) =>
          task.status === "completed" || task.status === "skipped" || task.status === "cancelled",
      )
    ) {
      await this.opts.repository
        .transitionItem({
          scope,
          work_item_id: workItemId,
          status: "blocked",
          reason: "Execution task cancelled without an active subagent.",
        })
        .catch(() => undefined);
      return;
    }

    const needsReady = tasks.some(
      (task) =>
        task.status === "queued" ||
        task.status === "leased" ||
        task.status === "running" ||
        task.status === "paused",
    );
    if (tasks.length === 0 || needsReady) {
      await this.opts.repository.requeueOrphanedTasks({
        scope,
        work_item_id: workItemId,
        updated_at: new Date().toISOString(),
      });
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "unassigned",
        provenance_json: { source: "workboard.reconciler" },
      });
      await this.opts.repository
        .transitionItem({
          scope,
          work_item_id: workItemId,
          status: "ready",
          reason: "Automatically requeued orphaned execution work.",
        })
        .catch(() => undefined);
    }
  }
}
