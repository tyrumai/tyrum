import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { WorkboardDal } from "./dal.js";
import { maybeFinalizeWorkItem } from "./orchestration-support.js";

const DEFAULT_TICK_MS = 2_000;

export class WorkboardReconciler {
  private readonly workboard: WorkboardDal;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      logger?: Logger;
      tickMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.workboard = new WorkboardDal(opts.db);
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.reconciler_tick_failed", { error: message });
      },
      tick: async () => {
        await this.tickOnce();
      },
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  async tick(): Promise<void> {
    await this.scheduler.tick();
  }

  private async tickOnce(): Promise<void> {
    const items = await this.opts.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id, work_item_id
       FROM work_items
       WHERE status = 'doing'
       ORDER BY updated_at ASC
       LIMIT 50`,
    );
    for (const item of items) {
      await this.reconcileDoingItem(
        {
          tenant_id: item.tenant_id,
          agent_id: item.agent_id,
          workspace_id: item.workspace_id,
        },
        item.work_item_id,
      );
    }
  }

  private async reconcileDoingItem(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ): Promise<void> {
    const activeSubagents = await this.workboard.listSubagents({
      scope,
      work_item_id: workItemId,
      statuses: ["running", "paused"],
      limit: 10,
    });
    if (activeSubagents.subagents.length > 0) {
      return;
    }

    const tasks = await this.workboard.listTasks({ scope, work_item_id: workItemId });
    if (tasks.some((task) => task.status === "failed")) {
      await this.workboard
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
        workboard: this.workboard,
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
      await this.workboard
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
      await this.opts.db.run(
        `UPDATE work_item_tasks
         SET status = CASE
             WHEN status IN ('leased', 'running', 'paused') THEN 'queued'
             ELSE status
           END,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           updated_at = ?
         WHERE tenant_id = ? AND work_item_id = ?`,
        [new Date().toISOString(), scope.tenant_id, workItemId],
      );
      await this.workboard.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.dispatch.phase",
        value_json: "unassigned",
        provenance_json: { source: "workboard.reconciler" },
      });
      await this.workboard
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
