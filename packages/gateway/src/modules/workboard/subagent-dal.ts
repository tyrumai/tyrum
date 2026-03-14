import { randomUUID } from "node:crypto";
import type {
  Lane,
  SubagentDescriptor,
  SubagentStatus,
  WorkItemState,
  WorkScope,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

import type { GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import { deleteTerminatedSubagentsBefore, updateSubagentRow } from "./subagent-dal-maintenance.js";

type WorkboardSubagentDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
};

export class WorkboardSubagentDal {
  constructor(private readonly deps: WorkboardSubagentDalDependencies) {}

  async createSubagent(params: {
    scope: WorkScope;
    subagent: {
      work_item_id?: string;
      work_item_task_id?: string;
      execution_profile: string;
      session_key: string;
      lane?: Lane;
      status?: SubagentStatus;
      desktop_environment_id?: string;
      attached_node_id?: string;
    };
    subagentId?: string;
    createdAtIso?: string;
  }): Promise<SubagentDescriptor> {
    const subagentId = params.subagentId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const lane: Lane = params.subagent.lane ?? "subagent";
    const status: SubagentStatus = params.subagent.status ?? "running";

    const inferredWorkItemId = await this.resolveTaskLinkedWorkItemId(
      params.scope,
      params.subagent.work_item_task_id,
    );
    await this.assertExplicitWorkItem(
      params.scope,
      params.subagent.work_item_id,
      inferredWorkItemId,
    );

    const row = await this.insertSubagent({
      scope: params.scope,
      subagentId,
      workItemId: params.subagent.work_item_id ?? inferredWorkItemId ?? null,
      workItemTaskId: params.subagent.work_item_task_id ?? null,
      executionProfile: params.subagent.execution_profile,
      sessionKey: params.subagent.session_key,
      lane,
      status,
      desktopEnvironmentId: params.subagent.desktop_environment_id ?? null,
      attachedNodeId: params.subagent.attached_node_id ?? null,
      createdAtIso,
    });
    return dalHelpers.toSubagent(row);
  }

  async heartbeatSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    heartbeatAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const heartbeatAtIso = params.heartbeatAtIso ?? new Date().toISOString();
    const row = await this.deps.db.get<DalHelpers.RawSubagentRow>(
      `UPDATE subagents
       SET last_heartbeat_at = ?, updated_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND subagent_id = ?
       RETURNING *`,
      [
        heartbeatAtIso,
        heartbeatAtIso,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.subagent_id,
      ],
    );
    return row ? dalHelpers.toSubagent(row) : undefined;
  }

  async getSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
  }): Promise<SubagentDescriptor | undefined> {
    const row = await this.deps.db.get<DalHelpers.RawSubagentRow>(
      `SELECT *
       FROM subagents
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND subagent_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.subagent_id,
      ],
    );
    return row ? dalHelpers.toSubagent(row) : undefined;
  }

  async listSubagents(params: {
    scope: WorkScope;
    statuses?: SubagentStatus[];
    work_item_id?: string;
    work_item_task_id?: string;
    execution_profile?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ subagents: SubagentDescriptor[]; next_cursor?: string }> {
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
    if (params.work_item_id) {
      where.push("work_item_id = ?");
      values.push(params.work_item_id);
    }
    if (params.work_item_task_id) {
      where.push("work_item_task_id = ?");
      values.push(params.work_item_task_id);
    }
    if (params.execution_profile) {
      where.push("execution_profile = ?");
      values.push(params.execution_profile);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(updated_at < ? OR (updated_at = ? AND subagent_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.deps.db.all<DalHelpers.RawSubagentRow>(
      `SELECT *
       FROM subagents
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, subagent_id DESC
       LIMIT ?`,
      values,
    );

    const subagents = rows.map(dalHelpers.toSubagent);
    const last = subagents.at(-1);
    const next_cursor =
      subagents.length === limit && last
        ? dalHelpers.encodeCursor({
            sort: last.updated_at ?? last.created_at,
            id: last.subagent_id,
          })
        : undefined;

    return { subagents, next_cursor };
  }

  private async setTerminalStatus(params: {
    scope: WorkScope;
    subagent_id: string;
    status: "closing" | "failed";
    occurredAtIso: string;
    reason?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const closeReason = params.reason?.trim() || null;

    return await this.deps.db.transaction(async (tx) => {
      const existing = await tx.get<DalHelpers.RawSubagentRow>(
        `SELECT *
         FROM subagents
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND subagent_id = ?`,
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.subagent_id,
        ],
      );
      if (!existing) return undefined;

      if (existing.status === "closed" || existing.status === "failed") {
        return dalHelpers.toSubagent(existing);
      }

      const row = await tx.get<DalHelpers.RawSubagentRow>(
        `UPDATE subagents
         SET status = ?,
             updated_at = ?,
             closed_at = COALESCE(closed_at, ?),
             close_reason = COALESCE(close_reason, ?)
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND subagent_id = ?
         RETURNING *`,
        [
          params.status,
          params.occurredAtIso,
          params.occurredAtIso,
          closeReason,
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.subagent_id,
        ],
      );
      return row ? dalHelpers.toSubagent(row) : undefined;
    });
  }

  async closeSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    reason?: string;
    closedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const nowIso = params.closedAtIso ?? new Date().toISOString();
    return await this.setTerminalStatus({
      scope: params.scope,
      subagent_id: params.subagent_id,
      status: "closing",
      occurredAtIso: nowIso,
      reason: params.reason,
    });
  }

  async markSubagentClosed(params: {
    scope: WorkScope;
    subagent_id: string;
    closedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const nowIso = params.closedAtIso ?? new Date().toISOString();

    return await this.deps.db.transaction(async (tx) => {
      const existing = await tx.get<DalHelpers.RawSubagentRow>(
        `SELECT *
         FROM subagents
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND subagent_id = ?`,
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.subagent_id,
        ],
      );
      if (!existing) return undefined;

      if (existing.status === "closed" || existing.status === "failed") {
        return dalHelpers.toSubagent(existing);
      }

      const row = await tx.get<DalHelpers.RawSubagentRow>(
        `UPDATE subagents
         SET status = ?,
             updated_at = ?,
             closed_at = COALESCE(closed_at, ?)
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND subagent_id = ?
         RETURNING *`,
        [
          "closed",
          nowIso,
          nowIso,
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.subagent_id,
        ],
      );
      return row ? dalHelpers.toSubagent(row) : undefined;
    });
  }

  async markSubagentFailed(params: {
    scope: WorkScope;
    subagent_id: string;
    reason?: string;
    failedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const nowIso = params.failedAtIso ?? new Date().toISOString();
    return await this.setTerminalStatus({
      scope: params.scope,
      subagent_id: params.subagent_id,
      status: "failed",
      occurredAtIso: nowIso,
      reason: params.reason,
    });
  }

  async updateSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    patch: {
      status?: SubagentStatus;
      desktop_environment_id?: string | null;
      attached_node_id?: string | null;
      close_reason?: string | null;
      closed_at?: string | null;
      last_heartbeat_at?: string | null;
    };
    updatedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();
    const row = await updateSubagentRow({
      db: this.deps.db,
      scope: params.scope,
      subagent_id: params.subagent_id,
      patch: params.patch,
      updatedAtIso,
    });
    return row ? dalHelpers.toSubagent(row) : undefined;
  }

  async deleteTerminatedSubagentsBefore(params: {
    scope: WorkScope;
    closedBeforeIso: string;
    limit?: number;
  }): Promise<number> {
    const limit = Math.max(1, Math.min(500, params.limit ?? 100));
    return await deleteTerminatedSubagentsBefore({
      db: this.deps.db,
      scope: params.scope,
      closedBeforeIso: params.closedBeforeIso,
      limit,
    });
  }

  private async resolveTaskLinkedWorkItemId(
    scope: WorkScope,
    workItemTaskId: string | undefined,
  ): Promise<string | undefined> {
    if (!workItemTaskId) {
      return undefined;
    }

    const task = await this.deps.db.get<{
      task_id: string;
      work_item_id: string;
      work_item_status: WorkItemState;
    }>(
      `SELECT t.task_id, t.work_item_id, i.status AS work_item_status
       FROM work_item_tasks t
       JOIN work_items i ON i.work_item_id = t.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND t.task_id = ?`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemTaskId],
    );
    if (!task) {
      throw new Error("work_item_task_id is outside scope");
    }
    if (dalHelpers.isTerminalWorkItemState(task.work_item_status)) {
      throw new Error(`cannot create subagent for terminal work item (${task.work_item_status})`);
    }
    return task.work_item_id;
  }

  private async assertExplicitWorkItem(
    scope: WorkScope,
    explicitWorkItemId: string | undefined,
    inferredWorkItemId: string | undefined,
  ): Promise<void> {
    if (!explicitWorkItemId) {
      return;
    }

    const item = await this.deps.getItem({ scope, work_item_id: explicitWorkItemId });
    if (!item) {
      throw new Error("work_item_id is outside scope");
    }
    if (dalHelpers.isTerminalWorkItemState(item.status)) {
      throw new Error(`cannot create subagent for terminal work item (${item.status})`);
    }
    if (inferredWorkItemId && inferredWorkItemId !== explicitWorkItemId) {
      throw new Error("work_item_task_id does not belong to work_item_id");
    }
  }

  private async insertSubagent(params: {
    scope: WorkScope;
    subagentId: string;
    workItemId: string | null;
    workItemTaskId: string | null;
    executionProfile: string;
    sessionKey: string;
    lane: Lane;
    status: SubagentStatus;
    desktopEnvironmentId: string | null;
    attachedNodeId: string | null;
    createdAtIso: string;
  }): Promise<DalHelpers.RawSubagentRow> {
    const row = await this.deps.db.get<DalHelpers.RawSubagentRow>(
      `INSERT INTO subagents (
         subagent_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         work_item_task_id,
         execution_profile,
         session_key,
         lane,
         status,
         desktop_environment_id,
         attached_node_id,
         created_at,
         updated_at,
         last_heartbeat_at,
         closed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.subagentId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.workItemId,
        params.workItemTaskId,
        params.executionProfile,
        params.sessionKey,
        params.lane,
        params.status,
        params.desktopEnvironmentId,
        params.attachedNodeId,
        params.createdAtIso,
        params.createdAtIso,
        null,
        null,
      ],
    );
    if (!row) {
      throw new Error("subagent insert failed");
    }
    return row;
  }
}
