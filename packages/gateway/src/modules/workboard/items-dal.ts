import { randomUUID } from "node:crypto";
import type {
  ExecutionBudgets,
  WorkItem,
  WorkItemKind,
  WorkItemState,
  WorkScope,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

type CreateItemInput = {
  kind: WorkItemKind;
  title: string;
  priority?: number;
  acceptance?: unknown;
  fingerprint?: unknown;
  budgets?: ExecutionBudgets;
  parent_work_item_id?: string;
  created_from_session_key?: string;
};

type UpdateItemPatch = {
  title?: string;
  priority?: number;
  acceptance?: unknown;
  fingerprint?: unknown;
  budgets?: ExecutionBudgets | null;
  last_active_at?: string | null;
};

export class WorkboardItemsDal {
  constructor(private readonly db: SqlDb) {}

  async createItem(params: {
    scope: WorkScope;
    item: CreateItemInput;
    workItemId?: string;
    createdAtIso?: string;
    createdFromSessionKey?: string;
  }): Promise<WorkItem> {
    const nowIso = params.createdAtIso ?? new Date().toISOString();
    const workItemId = params.workItemId?.trim() || randomUUID();
    const priority = params.item.priority ?? 0;
    const createdFromSessionKey =
      params.item.created_from_session_key?.trim() || params.createdFromSessionKey?.trim();
    if (!createdFromSessionKey) {
      throw new Error("created_from_session_key is required");
    }

    if (params.item.parent_work_item_id) {
      await this.assertParentInScope(params.scope, params.item.parent_work_item_id);
    }

    const row = await this.db.get<DalHelpers.RawWorkItemRow>(
      `INSERT INTO work_items (
         work_item_id,
         tenant_id,
         agent_id,
         workspace_id,
         kind,
         title,
         status,
         priority,
         acceptance_json,
         fingerprint_json,
         budgets_json,
         created_from_session_key,
         created_at,
         updated_at,
         last_active_at,
         parent_work_item_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        workItemId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.item.kind,
        params.item.title,
        priority,
        params.item.acceptance === undefined ? null : JSON.stringify(params.item.acceptance),
        params.item.fingerprint === undefined ? null : JSON.stringify(params.item.fingerprint),
        params.item.budgets === undefined ? null : JSON.stringify(params.item.budgets),
        createdFromSessionKey,
        nowIso,
        nowIso,
        null,
        params.item.parent_work_item_id ?? null,
      ],
    );
    if (!row) {
      throw new Error("work item insert failed");
    }
    return dalHelpers.toWorkItem(row);
  }

  async getItem(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItem | undefined> {
    const row = await this.db.get<DalHelpers.RawWorkItemRow>(
      `SELECT *
       FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
      ],
    );
    return row ? dalHelpers.toWorkItem(row) : undefined;
  }

  async listItems(params: {
    scope: WorkScope;
    statuses?: WorkItemState[];
    kinds?: WorkItemKind[];
    limit?: number;
    cursor?: string;
  }): Promise<{ items: WorkItem[]; next_cursor?: string }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.statuses && params.statuses.length > 0) {
      where.push(`status IN (${params.statuses.map(() => "?").join(", ")})`);
      values.push(...params.statuses);
    }

    if (params.kinds && params.kinds.length > 0) {
      where.push(`kind IN (${params.kinds.map(() => "?").join(", ")})`);
      values.push(...params.kinds);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND work_item_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawWorkItemRow>(
      `SELECT *
       FROM work_items
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, work_item_id DESC
       LIMIT ?`,
      values,
    );

    const items = rows.map(dalHelpers.toWorkItem);
    const last = items.at(-1);
    const next_cursor =
      items.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.work_item_id })
        : undefined;

    return { items, next_cursor };
  }

  async updateItem(params: {
    scope: WorkScope;
    work_item_id: string;
    patch: UpdateItemPatch;
    updatedAtIso?: string;
  }): Promise<WorkItem | undefined> {
    const update = this.buildUpdateStatement(
      params.patch,
      params.updatedAtIso ?? new Date().toISOString(),
    );
    if (!update) {
      return await this.getItem({ scope: params.scope, work_item_id: params.work_item_id });
    }

    const row = await this.db.get<DalHelpers.RawWorkItemRow>(
      `UPDATE work_items
       SET ${update.set.join(", ")}
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
       RETURNING *`,
      [
        ...update.values,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
      ],
    );
    return row ? dalHelpers.toWorkItem(row) : undefined;
  }

  async deleteItem(params: {
    scope: WorkScope;
    work_item_id: string;
  }): Promise<WorkItem | undefined> {
    const existing = await this.getItem(params);
    if (!existing) {
      return undefined;
    }

    const activeSubagent = await this.db.get<{ subagent_id: string }>(
      `SELECT subagent_id
       FROM subagents
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND status IN ('running', 'paused', 'closing')
       LIMIT 1`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
      ],
    );
    if (activeSubagent) {
      throw new Error("cannot delete work item with active subagents");
    }

    const activeTask = await this.db.get<{ task_id: string }>(
      `SELECT t.task_id
       FROM work_item_tasks t
       JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.tenant_id = ?
         AND t.work_item_id = ?
         AND t.status IN ('leased', 'running', 'paused')
       LIMIT 1`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.tenant_id,
        params.work_item_id,
      ],
    );
    if (activeTask) {
      throw new Error("cannot delete work item with active tasks");
    }

    const row = await this.db.get<DalHelpers.RawWorkItemRow>(
      `DELETE FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
      ],
    );
    return row ? dalHelpers.toWorkItem(row) : undefined;
  }

  private async assertParentInScope(scope: WorkScope, workItemId: string): Promise<void> {
    const parent = await this.getItem({ scope, work_item_id: workItemId });
    if (!parent) {
      throw new Error("parent_work_item_id is outside scope");
    }
  }

  private buildUpdateStatement(
    patch: UpdateItemPatch,
    updatedAtIso: string,
  ): { set: string[]; values: unknown[] } | undefined {
    const set: string[] = [];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
      set.push("title = ?");
      values.push(patch.title);
    }
    if (patch.priority !== undefined) {
      set.push("priority = ?");
      values.push(patch.priority);
    }
    if (patch.acceptance !== undefined) {
      set.push("acceptance_json = ?");
      values.push(JSON.stringify(patch.acceptance));
    }
    if (patch.fingerprint !== undefined) {
      set.push("fingerprint_json = ?");
      values.push(JSON.stringify(patch.fingerprint));
    }
    if (patch.budgets !== undefined) {
      set.push("budgets_json = ?");
      values.push(patch.budgets === null ? null : JSON.stringify(patch.budgets));
    }
    if (patch.last_active_at !== undefined) {
      set.push("last_active_at = ?");
      values.push(patch.last_active_at);
    }
    if (set.length === 0) {
      return undefined;
    }

    set.push("updated_at = ?");
    values.push(updatedAtIso);
    return { set, values };
  }
}
