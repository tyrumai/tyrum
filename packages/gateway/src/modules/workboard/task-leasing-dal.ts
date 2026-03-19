import { randomUUID } from "node:crypto";
import type { WorkItemTask, WorkItemTaskState, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type { EnqueueWsEventTxFn, GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import { isTerminalTaskState } from "./task-helpers.js";

type WorkboardTaskLeasingDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
  enqueueWsEventTx: EnqueueWsEventTxFn;
};

export class WorkboardTaskLeasingDal {
  constructor(private readonly deps: WorkboardTaskLeasingDalDependencies) {}

  async leaseRunnableTasks(params: {
    scope: WorkScope;
    work_item_id: string;
    lease_owner: string;
    nowMs?: number;
    leaseTtlMs?: number;
    limit?: number;
    updatedAtIso?: string;
  }): Promise<{ leased: Array<{ task: WorkItemTask; lease_expires_at_ms: number }> }> {
    const nowMs = params.nowMs ?? Date.now();
    const leaseTtlMs = Math.max(1_000, Math.floor(params.leaseTtlMs ?? 60_000));
    const leaseExpiresAtMs = nowMs + leaseTtlMs;
    const updatedAtIso = params.updatedAtIso ?? new Date(nowMs).toISOString();
    const limit = Math.max(1, Math.min(200, params.limit ?? 25));

    await this.assertWorkItemCanLease(params.scope, params.work_item_id);

    return await this.deps.db.transaction(async (tx) => {
      const rows = await this.loadScopedTasks(tx, params.scope, params.work_item_id);
      const runnable = this.findRunnableTaskIds(rows, nowMs);
      const leased = await this.leaseTasks(
        tx,
        params.scope.tenant_id,
        params.lease_owner,
        leaseExpiresAtMs,
        updatedAtIso,
        nowMs,
        runnable.slice(0, limit),
      );

      await this.emitLeaseEvents(tx, params.scope, params.work_item_id, leased, updatedAtIso);
      return { leased };
    });
  }

  private async assertWorkItemCanLease(scope: WorkScope, workItemId: string): Promise<void> {
    const item = await this.deps.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      throw new Error("work item not found for lease");
    }
    if (dalHelpers.isTerminalWorkItemState(item.status)) {
      throw new Error(`cannot lease tasks for terminal work item (${item.status})`);
    }
  }

  private async loadScopedTasks(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
  ): Promise<DalHelpers.RawWorkItemTaskRow[]> {
    return await tx.all<DalHelpers.RawWorkItemTaskRow>(
      `SELECT t.*
       FROM work_item_tasks t
       JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.tenant_id = ?
         AND t.work_item_id = ?
       ORDER BY t.created_at ASC, t.task_id ASC`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, scope.tenant_id, workItemId],
    );
  }

  private findRunnableTaskIds(rows: DalHelpers.RawWorkItemTaskRow[], nowMs: number): string[] {
    const statusById = new Map<string, WorkItemTaskState>();
    const depsById = new Map<string, string[]>();
    for (const row of rows) {
      statusById.set(row.task_id, row.status as WorkItemTaskState);
      depsById.set(row.task_id, dalHelpers.parseTaskDepsJson(row.depends_on_json));
    }

    const runnable: string[] = [];
    for (const row of rows) {
      const status = row.status as WorkItemTaskState;
      const expiredLease =
        status === "leased" &&
        (row.lease_expires_at_ms === null ||
          row.lease_expires_at_ms === undefined ||
          row.lease_expires_at_ms <= nowMs);
      if (status !== "queued" && !expiredLease) continue;

      const deps = depsById.get(row.task_id) ?? [];
      if (deps.every((depId) => isTerminalTaskState(statusById.get(depId)))) {
        runnable.push(row.task_id);
      }
    }
    return runnable;
  }

  private async leaseTasks(
    tx: SqlDb,
    tenantId: string,
    leaseOwner: string,
    leaseExpiresAtMs: number,
    updatedAtIso: string,
    nowMs: number,
    taskIds: string[],
  ): Promise<Array<{ task: WorkItemTask; lease_expires_at_ms: number }>> {
    const leased: Array<{ task: WorkItemTask; lease_expires_at_ms: number }> = [];
    for (const taskId of taskIds) {
      const updated = await tx.get<DalHelpers.RawWorkItemTaskRow>(
        `UPDATE work_item_tasks
         SET status = 'leased',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND task_id = ?
           AND (
             status = 'queued'
             OR (status = 'leased' AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?))
           )
         RETURNING *`,
        [leaseOwner, leaseExpiresAtMs, updatedAtIso, tenantId, taskId, nowMs],
      );
      if (!updated) continue;

      leased.push({
        task: dalHelpers.toWorkItemTask(updated),
        lease_expires_at_ms: leaseExpiresAtMs,
      });
    }
    return leased;
  }

  private async emitLeaseEvents(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
    leased: Array<{ task: WorkItemTask; lease_expires_at_ms: number }>,
    occurredAtIso: string,
  ): Promise<void> {
    for (const entry of leased) {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.leased",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: workItemId,
          task_id: entry.task.task_id,
          lease_expires_at_ms: entry.lease_expires_at_ms,
        },
      });
    }
  }
}
