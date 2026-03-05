import type { WorkItemTaskState, WorkScope } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

import * as dalHelpers from "./dal-helpers.js";

export async function assertTaskDependenciesInWorkItem(
  db: SqlDb,
  params: {
    scope: WorkScope;
    taskIds: string[];
    workItemId: string;
  },
): Promise<void> {
  if (params.taskIds.length === 0) {
    return;
  }

  const placeholders = params.taskIds.map(() => "?").join(", ");
  const rows = await db.all<{ task_id: string; work_item_id: string }>(
    `SELECT t.task_id, t.work_item_id
     FROM work_item_tasks t
     JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
     WHERE i.tenant_id = ?
       AND i.agent_id = ?
       AND i.workspace_id = ?
       AND t.tenant_id = ?
       AND t.task_id IN (${placeholders})`,
    [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
      params.scope.tenant_id,
      ...params.taskIds,
    ],
  );

  const byId = new Map(rows.map((row) => [row.task_id, row]));
  for (const taskId of params.taskIds) {
    const dep = byId.get(taskId);
    if (!dep) {
      throw new Error(`depends_on task not found: ${taskId}`);
    }
    if (dep.work_item_id !== params.workItemId) {
      throw new Error("depends_on task is outside work_item_id");
    }
  }
}

export async function assertNoTaskDependencyCycle(
  db: SqlDb,
  params: {
    scope: WorkScope;
    workItemId: string;
    taskId: string;
    dependsOn: string[];
  },
): Promise<void> {
  const allTasks = await db.all<{ task_id: string; depends_on_json: string }>(
    `SELECT t.task_id, t.depends_on_json
     FROM work_item_tasks t
     JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
     WHERE i.tenant_id = ?
       AND i.agent_id = ?
       AND i.workspace_id = ?
       AND t.tenant_id = ?
       AND t.work_item_id = ?`,
    [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
      params.scope.tenant_id,
      params.workItemId,
    ],
  );

  const adj = new Map<string, string[]>();
  for (const row of allTasks) {
    adj.set(row.task_id, dalHelpers.parseTaskDepsJson(row.depends_on_json));
  }
  adj.set(params.taskId, params.dependsOn);

  if (dalHelpers.hasTaskDependencyCycle(adj)) {
    throw new Error("task dependency cycle detected");
  }
}

export function isTerminalTaskState(status: WorkItemTaskState | undefined): boolean {
  return (
    status === "completed" || status === "skipped" || status === "cancelled" || status === "failed"
  );
}
