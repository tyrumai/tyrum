import { randomUUID } from "node:crypto";
import type { WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import type { GetItemFn } from "./dal-deps.js";

type WorkboardItemRelationsDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
};

export class WorkboardItemRelationsDal {
  constructor(private readonly deps: WorkboardItemRelationsDalDependencies) {}

  async appendEvent(params: {
    scope: WorkScope;
    work_item_id: string;
    kind: string;
    payload_json?: unknown;
    eventId?: string;
    createdAtIso?: string;
  }): Promise<DalHelpers.WorkItemEventRow> {
    const eventId = params.eventId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    const item = await this.deps.getItem({
      scope: params.scope,
      work_item_id: params.work_item_id,
    });
    if (!item) {
      throw new Error("work item not found for event");
    }

    const row = await this.deps.db.get<DalHelpers.RawWorkItemEventRow>(
      `INSERT INTO work_item_events (tenant_id, event_id, work_item_id, created_at, kind, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.scope.tenant_id,
        eventId,
        params.work_item_id,
        createdAtIso,
        params.kind,
        JSON.stringify(params.payload_json ?? {}),
      ],
    );
    if (!row) {
      throw new Error("work item event insert failed");
    }
    return dalHelpers.toWorkItemEvent(row);
  }

  async listEvents(params: {
    scope: WorkScope;
    work_item_id: string;
    limit?: number;
  }): Promise<{ events: DalHelpers.WorkItemEventRow[]; next_cursor?: string }> {
    const limit = Math.max(1, Math.min(200, params.limit ?? 50));

    const rows = await this.deps.db.all<DalHelpers.RawWorkItemEventRow>(
      `SELECT e.*
       FROM work_item_events e
       JOIN work_items i ON i.tenant_id = e.tenant_id AND i.work_item_id = e.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND e.work_item_id = ?
       ORDER BY e.created_at DESC, e.event_id DESC
       LIMIT ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
        limit,
      ],
    );

    return { events: rows.map(dalHelpers.toWorkItemEvent) };
  }

  async createLink(params: {
    scope: WorkScope;
    work_item_id: string;
    linked_work_item_id: string;
    kind: string;
    meta_json?: unknown;
    createdAtIso?: string;
  }): Promise<DalHelpers.WorkItemLinkRow> {
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    return await this.deps.db.transaction(async (tx) => {
      await this.assertScopedWorkItem(
        tx,
        params.scope,
        params.work_item_id,
        "work item not found for link",
      );
      await this.assertScopedWorkItem(
        tx,
        params.scope,
        params.linked_work_item_id,
        "linked work item not found for link",
      );

      const row = await tx.get<DalHelpers.RawWorkItemLinkRow>(
        `INSERT INTO work_item_links (
           tenant_id,
           work_item_id,
           linked_work_item_id,
           kind,
           meta_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          params.scope.tenant_id,
          params.work_item_id,
          params.linked_work_item_id,
          params.kind,
          JSON.stringify(params.meta_json ?? {}),
          createdAtIso,
        ],
      );
      if (!row) {
        throw new Error("work item link insert failed");
      }
      return dalHelpers.toWorkItemLink(row);
    });
  }

  async listLinks(params: {
    scope: WorkScope;
    work_item_id: string;
    limit?: number;
  }): Promise<{ links: DalHelpers.WorkItemLinkRow[] }> {
    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    const rows = await this.deps.db.all<DalHelpers.RawWorkItemLinkRow>(
      `SELECT l.*
       FROM work_item_links l
       JOIN work_items i ON i.tenant_id = l.tenant_id AND i.work_item_id = l.work_item_id
       WHERE i.tenant_id = ?
         AND i.agent_id = ?
         AND i.workspace_id = ?
         AND l.work_item_id = ?
       ORDER BY l.created_at DESC, l.linked_work_item_id DESC
       LIMIT ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
        limit,
      ],
    );
    return { links: rows.map(dalHelpers.toWorkItemLink) };
  }

  private async assertScopedWorkItem(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
    message: string,
  ): Promise<void> {
    const row = await tx.get<{ work_item_id: string }>(
      `SELECT work_item_id
       FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
    );
    if (!row) {
      throw new Error(message);
    }
  }
}
