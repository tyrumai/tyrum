import { randomUUID } from "node:crypto";
import type { WorkItemTask, WorkItemTaskState, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type { GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import { assertTaskDependenciesInWorkItem } from "./task-helpers.js";

type WorkboardTasksDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
};

export class WorkboardTasksDal {
  constructor(private readonly deps: WorkboardTasksDalDependencies) {}

  async createTask(params: {
    scope: WorkScope;
    task: {
      work_item_id: string;
      status?: WorkItemTaskState;
      depends_on?: string[];
      execution_profile: string;
      side_effect_class: string;
      turn_id?: string;
      approval_id?: string;
      artifacts?: unknown[];
      started_at?: string | null;
      finished_at?: string | null;
      result_summary?: string;
    };
    taskId?: string;
    createdAtIso?: string;
  }): Promise<WorkItemTask> {
    const taskId = params.taskId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const dependsOn = dalHelpers.normalizeTaskDeps(params.task.depends_on);

    if (dependsOn.includes(taskId)) {
      throw new Error("work item task depends_on cannot include itself");
    }

    await this.assertCreateTaskAllowed(params.scope, params.task.work_item_id, dependsOn);
    const row = await this.insertTask(
      taskId,
      createdAtIso,
      params.task,
      dependsOn,
      params.scope.tenant_id,
    );
    return dalHelpers.toWorkItemTask(row);
  }

  async listTasks(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItemTask[]> {
    const rows = await this.deps.db.all<DalHelpers.RawWorkItemTaskRow>(
      `SELECT t.*
       FROM work_item_tasks t
       JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.tenant_id = ?
         AND t.work_item_id = ?
       ORDER BY t.created_at ASC, t.task_id ASC`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.tenant_id,
        params.work_item_id,
      ],
    );
    return rows.map(dalHelpers.toWorkItemTask);
  }

  async getTask(params: { scope: WorkScope; task_id: string }): Promise<WorkItemTask | undefined> {
    const row = await this.deps.db.get<DalHelpers.RawWorkItemTaskRow>(
      `SELECT t.*
       FROM work_item_tasks t
       JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.tenant_id = ?
         AND t.task_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.tenant_id,
        params.task_id,
      ],
    );
    return row ? dalHelpers.toWorkItemTask(row) : undefined;
  }

  async deleteTask(params: {
    scope: WorkScope;
    task_id: string;
  }): Promise<WorkItemTask | undefined> {
    const existing = await this.getTask(params);
    if (!existing) {
      return undefined;
    }
    if (["leased", "running", "paused"].includes(existing.status)) {
      throw new Error(`cannot delete active task (${existing.status})`);
    }

    const row = await this.deps.db.get<DalHelpers.RawWorkItemTaskRow>(
      `DELETE FROM work_item_tasks
       WHERE tenant_id = ?
         AND task_id = ?
         AND work_item_id IN (
           SELECT work_item_id
           FROM work_items
           WHERE tenant_id = ?
             AND agent_id = ?
             AND workspace_id = ?
         )
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.task_id,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
      ],
    );
    return row ? dalHelpers.toWorkItemTask(row) : undefined;
  }

  private async assertCreateTaskAllowed(
    scope: WorkScope,
    workItemId: string,
    dependsOn: string[],
  ): Promise<void> {
    const item = await this.deps.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      throw new Error("work item not found for task");
    }
    if (dalHelpers.isTerminalWorkItemState(item.status)) {
      throw new Error(`cannot create task for terminal work item (${item.status})`);
    }

    await assertTaskDependenciesInWorkItem(this.deps.db, {
      scope,
      taskIds: dependsOn,
      workItemId,
    });
  }

  private async insertTask(
    taskId: string,
    createdAtIso: string,
    task: {
      work_item_id: string;
      status?: WorkItemTaskState;
      execution_profile: string;
      side_effect_class: string;
      turn_id?: string;
      approval_id?: string;
      artifacts?: unknown[];
      started_at?: string | null;
      finished_at?: string | null;
      result_summary?: string;
    },
    dependsOn: string[],
    tenantId: string,
  ): Promise<DalHelpers.RawWorkItemTaskRow> {
    const row = await this.deps.db.get<DalHelpers.RawWorkItemTaskRow>(
      `INSERT INTO work_item_tasks (
         tenant_id,
         task_id,
         work_item_id,
         status,
         depends_on_json,
         execution_profile,
         side_effect_class,
         turn_id,
         approval_id,
         artifacts_json,
         started_at,
         finished_at,
         result_summary,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        tenantId,
        taskId,
        task.work_item_id,
        task.status ?? "queued",
        JSON.stringify(dependsOn),
        task.execution_profile,
        task.side_effect_class,
        task.turn_id ?? null,
        task.approval_id ?? null,
        JSON.stringify(task.artifacts ?? []),
        task.started_at ?? null,
        task.finished_at ?? null,
        task.result_summary ?? null,
        createdAtIso,
        createdAtIso,
      ],
    );
    if (!row) {
      throw new Error("work item task insert failed");
    }
    return row;
  }
}
