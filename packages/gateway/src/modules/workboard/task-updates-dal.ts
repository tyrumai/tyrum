import { randomUUID } from "node:crypto";
import type { WorkItemTask, WorkItemTaskState, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type { EnqueueWsEventTxFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import { assertNoTaskDependencyCycle, assertTaskDependenciesInWorkItem } from "./task-helpers.js";

type WorkboardTaskUpdatesDalDependencies = {
  db: SqlDb;
  enqueueWsEventTx: EnqueueWsEventTxFn;
};

type TaskUpdatePatch = {
  status?: WorkItemTaskState;
  depends_on?: string[];
  execution_profile?: string;
  side_effect_class?: string;
  run_id?: string | null;
  subagent_id?: string | null;
  approval_id?: string | null;
  pause_reason?: string | null;
  pause_detail?: string | null;
  artifacts?: unknown[];
  started_at?: string | null;
  finished_at?: string | null;
  result_summary?: string | null;
};

type TaskUpdateSet = {
  set: string[];
  values: unknown[];
};

export class WorkboardTaskUpdatesDal {
  constructor(private readonly deps: WorkboardTaskUpdatesDalDependencies) {}

  async updateTask(params: {
    scope: WorkScope;
    task_id: string;
    lease_owner?: string;
    nowMs?: number;
    patch: TaskUpdatePatch;
    updatedAtIso?: string;
  }): Promise<WorkItemTask | undefined> {
    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();

    return await this.deps.db.transaction(async (tx) => {
      const existing = await this.getScopedTask(tx, params.scope, params.task_id);
      if (!existing) return undefined;

      const previousStatus = existing.status as WorkItemTaskState;
      const leavingLease = this.isLeavingLease(previousStatus, params.patch.status);
      this.assertLeaseMutationAllowed(
        existing,
        params.lease_owner,
        params.nowMs ?? Date.now(),
        leavingLease,
      );

      const normalizedDependsOn = await this.resolveNormalizedDependsOn(
        tx,
        params.scope,
        params.task_id,
        existing,
        params.patch,
      );
      const update = this.buildUpdateSet(
        params.patch,
        normalizedDependsOn,
        leavingLease,
        updatedAtIso,
      );
      if (!update) {
        return dalHelpers.toWorkItemTask(existing);
      }

      const row = await this.updateTaskRow(tx, params.scope.tenant_id, params.task_id, update);
      if (!row) return undefined;

      const updated = dalHelpers.toWorkItemTask(row);
      await this.emitStatusChange(
        tx,
        params.scope,
        updatedAtIso,
        previousStatus,
        updated,
        params.patch,
      );
      return updated;
    });
  }

  private async getScopedTask(
    tx: SqlDb,
    scope: WorkScope,
    taskId: string,
  ): Promise<DalHelpers.RawWorkItemTaskRow | undefined> {
    return await tx.get<DalHelpers.RawWorkItemTaskRow>(
      `SELECT t.*
       FROM work_item_tasks t
       JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.tenant_id = ?
         AND t.task_id = ?`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, scope.tenant_id, taskId],
    );
  }

  private isLeavingLease(
    previousStatus: WorkItemTaskState,
    nextStatus: WorkItemTaskState | undefined,
  ): boolean {
    return previousStatus === "leased" && nextStatus !== undefined && nextStatus !== "leased";
  }

  private assertLeaseMutationAllowed(
    existing: DalHelpers.RawWorkItemTaskRow,
    leaseOwner: string | undefined,
    nowMs: number,
    leavingLease: boolean,
  ): void {
    if (!leavingLease) {
      return;
    }

    const owner = leaseOwner?.trim();
    if (!owner) {
      throw new Error("lease_owner is required to update leased tasks");
    }
    if ((existing.lease_owner ?? null) !== owner) {
      throw new Error("lease_owner mismatch");
    }

    const expiresAt = existing.lease_expires_at_ms ?? null;
    if (expiresAt === null || expiresAt <= nowMs) {
      throw new Error("task lease expired");
    }
  }

  private async resolveNormalizedDependsOn(
    tx: SqlDb,
    scope: WorkScope,
    taskId: string,
    existing: DalHelpers.RawWorkItemTaskRow,
    patch: TaskUpdatePatch,
  ): Promise<string[] | undefined> {
    if (patch.depends_on === undefined) {
      return undefined;
    }

    const normalized = dalHelpers.normalizeTaskDeps(patch.depends_on);
    if (normalized.includes(taskId)) {
      throw new Error("work item task depends_on cannot include itself");
    }

    await assertTaskDependenciesInWorkItem(tx, {
      scope,
      taskIds: normalized,
      workItemId: existing.work_item_id,
    });
    await assertNoTaskDependencyCycle(tx, {
      scope,
      workItemId: existing.work_item_id,
      taskId,
      dependsOn: normalized,
    });
    return normalized;
  }

  private buildUpdateSet(
    patch: TaskUpdatePatch,
    normalizedDependsOn: string[] | undefined,
    leavingLease: boolean,
    updatedAtIso: string,
  ): TaskUpdateSet | undefined {
    const set: string[] = [];
    const values: unknown[] = [];

    if (patch.status !== undefined) {
      set.push("status = ?");
      values.push(patch.status);
    }
    if (leavingLease) {
      set.push("lease_owner = NULL");
      set.push("lease_expires_at_ms = NULL");
    }
    if (normalizedDependsOn !== undefined) {
      set.push("depends_on_json = ?");
      values.push(JSON.stringify(normalizedDependsOn));
    }
    if (patch.execution_profile !== undefined) {
      set.push("execution_profile = ?");
      values.push(patch.execution_profile);
    }
    if (patch.side_effect_class !== undefined) {
      set.push("side_effect_class = ?");
      values.push(patch.side_effect_class);
    }
    if (patch.run_id !== undefined) {
      set.push("run_id = ?");
      values.push(patch.run_id);
    }
    if (patch.approval_id !== undefined) {
      set.push("approval_id = ?");
      values.push(patch.approval_id);
    }
    if (patch.artifacts !== undefined) {
      set.push("artifacts_json = ?");
      values.push(JSON.stringify(patch.artifacts));
    }
    if (patch.started_at !== undefined) {
      set.push("started_at = ?");
      values.push(patch.started_at);
    }
    if (patch.finished_at !== undefined) {
      set.push("finished_at = ?");
      values.push(patch.finished_at);
    }
    if (patch.result_summary !== undefined) {
      set.push("result_summary = ?");
      values.push(patch.result_summary);
    }
    if (set.length === 0) {
      return undefined;
    }

    set.push("updated_at = ?");
    values.push(updatedAtIso);
    return { set, values };
  }

  private async updateTaskRow(
    tx: SqlDb,
    tenantId: string,
    taskId: string,
    update: TaskUpdateSet,
  ): Promise<DalHelpers.RawWorkItemTaskRow | undefined> {
    return await tx.get<DalHelpers.RawWorkItemTaskRow>(
      `UPDATE work_item_tasks
       SET ${update.set.join(", ")}
       WHERE tenant_id = ?
         AND task_id = ?
       RETURNING *`,
      [...update.values, tenantId, taskId],
    );
  }

  private async emitStatusChange(
    tx: SqlDb,
    scope: WorkScope,
    occurredAtIso: string,
    previousStatus: WorkItemTaskState,
    updated: WorkItemTask,
    patch: TaskUpdatePatch,
  ): Promise<void> {
    if (updated.status === previousStatus) {
      return;
    }

    if (updated.status === "running") {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.started",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: updated.work_item_id,
          task_id: updated.task_id,
          ...(updated.run_id ? { run_id: updated.run_id } : {}),
          ...(patch.subagent_id ? { subagent_id: patch.subagent_id } : {}),
        },
      });
      return;
    }

    if (updated.status === "paused") {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.paused",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: updated.work_item_id,
          task_id: updated.task_id,
          ...(updated.approval_id ? { approval_id: updated.approval_id } : {}),
          ...(patch.pause_reason ? { pause_reason: patch.pause_reason } : {}),
          ...(patch.pause_detail ? { pause_detail: patch.pause_detail } : {}),
        },
      });
      return;
    }

    if (updated.status === "completed") {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.completed",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: updated.work_item_id,
          task_id: updated.task_id,
          ...(updated.result_summary ? { result_summary: updated.result_summary } : {}),
        },
      });
      return;
    }

    if (updated.status === "failed") {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.failed",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: updated.work_item_id,
          task_id: updated.task_id,
          ...(updated.result_summary ? { result_summary: updated.result_summary } : {}),
        },
      });
      return;
    }

    if (updated.status === "cancelled") {
      await this.deps.enqueueWsEventTx(tx, {
        event_id: randomUUID(),
        type: "work.task.cancelled",
        occurred_at: occurredAtIso,
        scope: { kind: "agent", agent_id: scope.agent_id },
        payload: {
          ...scope,
          work_item_id: updated.work_item_id,
          task_id: updated.task_id,
          ...(updated.result_summary ? { result_summary: updated.result_summary } : {}),
        },
      });
    }
  }
}
