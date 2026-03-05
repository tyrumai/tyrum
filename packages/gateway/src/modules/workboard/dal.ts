import { randomUUID } from "node:crypto";
import type {
  AgentStateKVEntry,
  DecisionRecord,
  ExecutionBudgets,
  WorkArtifact,
  WorkArtifactKind,
  WorkItem,
  WorkItemKind,
  WorkItemState,
  WorkItemTask,
  WorkItemTaskState,
  WorkItemStateKVEntry,
  WorkScope,
  WsEventEnvelope,
  WorkSignal,
  WorkSignalStatus,
  WorkSignalTriggerKind,
  WorkStateKVKey,
  WorkStateKVScopeIds,
  SubagentDescriptor,
  SubagentStatus,
  Lane,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

export type { WorkItemEventRow, WorkItemLinkRow, WorkScopeActivityRow } from "./dal-helpers.js";
export type { WorkboardTransitionErrorDetails } from "./dal-helpers.js";
export { WorkboardTransitionError } from "./dal-helpers.js";

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

export class WorkboardDal {
  constructor(
    private readonly db: SqlDb,
    private readonly redactionEngine?: RedactionEngine,
  ) {}

  private async enqueueWsEventTx(tx: SqlDb, evt: WsEventEnvelope): Promise<void> {
    const payload = { message: evt, audience: dalHelpers.WORKBOARD_WS_AUDIENCE };
    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload).redacted
      : payload;
    const tenantId =
      typeof (evt.payload as any)?.tenant_id === "string" && (evt.payload as any).tenant_id.trim()
        ? ((evt.payload as any).tenant_id as string)
        : DEFAULT_TENANT_ID;
    await tx.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
       VALUES (?, ?, ?, ?)`,
      [tenantId, "ws.broadcast", null, JSON.stringify(redactedPayload)],
    );
  }

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
      const parent = await this.getItem({
        scope: params.scope,
        work_item_id: params.item.parent_work_item_id,
      });
      if (!parent) {
        throw new Error("parent_work_item_id is outside scope");
      }
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

    const sql =
      `SELECT * FROM work_items` +
      ` WHERE ${where.join(" AND ")}` +
      ` ORDER BY created_at DESC, work_item_id DESC LIMIT ?`;
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawWorkItemRow>(sql, values);
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
    const set: string[] = [];
    const values: unknown[] = [];

    if (params.patch.title !== undefined) {
      set.push("title = ?");
      values.push(params.patch.title);
    }
    if (params.patch.priority !== undefined) {
      set.push("priority = ?");
      values.push(params.patch.priority);
    }
    if (params.patch.acceptance !== undefined) {
      set.push("acceptance_json = ?");
      values.push(JSON.stringify(params.patch.acceptance));
    }
    if (params.patch.fingerprint !== undefined) {
      set.push("fingerprint_json = ?");
      values.push(JSON.stringify(params.patch.fingerprint));
    }
    if (params.patch.budgets !== undefined) {
      set.push("budgets_json = ?");
      values.push(params.patch.budgets === null ? null : JSON.stringify(params.patch.budgets));
    }
    if (params.patch.last_active_at !== undefined) {
      set.push("last_active_at = ?");
      values.push(params.patch.last_active_at);
    }

    if (set.length === 0) {
      return await this.getItem({ scope: params.scope, work_item_id: params.work_item_id });
    }

    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();
    set.push("updated_at = ?");
    values.push(updatedAtIso);

    const row = await this.db.get<DalHelpers.RawWorkItemRow>(
      `UPDATE work_items
       SET ${set.join(", ")}
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
       RETURNING *`,
      [
        ...values,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.work_item_id,
      ],
    );
    return row ? dalHelpers.toWorkItem(row) : undefined;
  }

  async transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<WorkItem | undefined> {
    const occurredAtIso = params.occurredAtIso ?? new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<DalHelpers.RawWorkItemRow>(
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
      if (!existing) return undefined;

      const from = existing.status as WorkItemState;
      const allowed = dalHelpers.WORK_ITEM_TRANSITIONS[from];
      if (!allowed.includes(params.status)) {
        throw new dalHelpers.WorkboardTransitionError(
          "invalid_transition",
          {
            code: "invalid_transition",
            from,
            to: params.status,
            allowed,
          },
          `invalid transition from ${from} to ${params.status}`,
        );
      }

      if (params.status === "doing") {
        if (tx.kind === "postgres") {
          await tx.get("SELECT pg_advisory_xact_lock($1, $2)", [
            dalHelpers.hashScopeLockSeed(`${params.scope.tenant_id}|${params.scope.agent_id}`),
            dalHelpers.hashScopeLockSeed(params.scope.workspace_id),
          ]);
        }

        const doingCount = await tx.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM work_items
           WHERE tenant_id = ?
             AND agent_id = ?
             AND workspace_id = ?
             AND status = 'doing'`,
          [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id],
        );
        const currentDoing = dalHelpers.normalizeCount(doingCount?.count);
        if (currentDoing >= dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT) {
          throw new dalHelpers.WorkboardTransitionError(
            "wip_limit_exceeded",
            {
              code: "wip_limit_exceeded",
              from,
              to: "doing",
              limit: dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT,
              current: currentDoing,
            },
            `WIP limit ${dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT} reached for doing items`,
          );
        }
      }

      const updated = await tx.get<DalHelpers.RawWorkItemRow>(
        `UPDATE work_items
         SET status = ?, updated_at = ?
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND work_item_id = ?
         RETURNING *`,
        [
          params.status,
          occurredAtIso,
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.work_item_id,
        ],
      );
      if (!updated) return undefined;

      await tx.run(
        `INSERT INTO work_item_events (tenant_id, event_id, work_item_id, created_at, kind, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          params.scope.tenant_id,
          randomUUID(),
          params.work_item_id,
          occurredAtIso,
          "status.transition",
          JSON.stringify({
            from: existing.status,
            to: params.status,
            reason: params.reason ?? null,
          }),
        ],
      );

      if (dalHelpers.isTerminalWorkItemState(params.status)) {
        const reasonText = params.reason?.trim() || `work item ${params.status}`;
        const parsedOccurredAtMs = Date.parse(occurredAtIso);
        const occurredAtMs = Number.isFinite(parsedOccurredAtMs) ? parsedOccurredAtMs : Date.now();

        await tx.run(
          `UPDATE work_item_tasks
           SET status = 'cancelled',
               lease_owner = NULL,
               lease_expires_at_ms = NULL,
               updated_at = ?,
               finished_at = COALESCE(finished_at, ?)
           WHERE tenant_id = ?
             AND work_item_id = ?
             AND status IN ('queued', 'leased', 'running', 'paused')`,
          [occurredAtIso, occurredAtIso, params.scope.tenant_id, params.work_item_id],
        );

        const signals = new LaneQueueSignalDal(tx);
        const runningSubagents = await tx.all<{ session_key: string; lane: string }>(
          `SELECT session_key, lane
           FROM subagents
           WHERE tenant_id = ?
             AND agent_id = ?
             AND workspace_id = ?
             AND work_item_id = ?
             AND status = 'running'`,
          [
            params.scope.tenant_id,
            params.scope.agent_id,
            params.scope.workspace_id,
            params.work_item_id,
          ],
        );

        for (const subagent of runningSubagents) {
          await signals.setSignal({
            tenant_id: params.scope.tenant_id,
            key: subagent.session_key,
            lane: subagent.lane,
            kind: "interrupt",
            inbox_id: null,
            queue_mode: "interrupt",
            message_text: reasonText,
            created_at_ms: occurredAtMs,
          });
        }

        await tx.run(
          `UPDATE subagents
           SET status = 'closed',
               updated_at = ?,
               closed_at = COALESCE(closed_at, ?),
               close_reason = COALESCE(close_reason, ?)
           WHERE tenant_id = ?
             AND agent_id = ?
             AND workspace_id = ?
             AND work_item_id = ?
             AND status NOT IN ('closed', 'failed')`,
          [
            occurredAtIso,
            occurredAtIso,
            reasonText,
            params.scope.tenant_id,
            params.scope.agent_id,
            params.scope.workspace_id,
            params.work_item_id,
          ],
        );
      }

      return dalHelpers.toWorkItem(updated);
    });
  }

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

    const item = await this.getItem({ scope: params.scope, work_item_id: params.work_item_id });
    if (!item) {
      throw new Error("work item not found for event");
    }

    const row = await this.db.get<DalHelpers.RawWorkItemEventRow>(
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

    const rows = await this.db.all<DalHelpers.RawWorkItemEventRow>(
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

  async getStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: WorkStateKVKey;
  }): Promise<(AgentStateKVEntry | WorkItemStateKVEntry) | undefined> {
    if (params.scope.kind === "agent") {
      const row = await this.db.get<DalHelpers.RawKvRow>(
        `SELECT *
         FROM agent_state_kv
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND key = ?`,
        [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.key],
      );
      return row ? (dalHelpers.toKvEntry(row) as AgentStateKVEntry) : undefined;
    }

    const row = await this.db.get<DalHelpers.RawKvRow>(
      `SELECT *
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.work_item_id,
        params.key,
      ],
    );
    return row
      ? (dalHelpers.toKvEntry({
          ...row,
          work_item_id: params.scope.work_item_id,
        }) as WorkItemStateKVEntry)
      : undefined;
  }

  async listStateKv(params: {
    scope: WorkStateKVScopeIds;
    prefix?: string;
  }): Promise<{ entries: (AgentStateKVEntry | WorkItemStateKVEntry)[] }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.scope.kind === "work_item") {
      where.push("work_item_id = ?");
      values.push(params.scope.work_item_id);
    }

    if (params.prefix) {
      where.push("key LIKE ? ESCAPE '\\'");
      values.push(`${dalHelpers.escapeLikePattern(params.prefix)}%`);
    }

    const table = params.scope.kind === "agent" ? "agent_state_kv" : "work_item_state_kv";
    const sql = `SELECT * FROM ${table}` + ` WHERE ${where.join(" AND ")}` + ` ORDER BY key ASC`;

    const rows = await this.db.all<DalHelpers.RawKvRow>(sql, values);
    const entries = rows.map((r) =>
      dalHelpers.toKvEntry(
        params.scope.kind === "work_item" ? { ...r, work_item_id: params.scope.work_item_id } : r,
      ),
    );
    return { entries };
  }

  async setStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: WorkStateKVKey;
    value_json: unknown;
    provenance_json?: unknown;
    updatedByRunId?: string;
    updatedAtIso?: string;
  }): Promise<AgentStateKVEntry | WorkItemStateKVEntry> {
    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();
    const valueJson = JSON.stringify(params.value_json ?? null);
    const provenanceJson =
      params.provenance_json === undefined ? null : JSON.stringify(params.provenance_json);
    const updatedByRunId = params.updatedByRunId ?? null;

    if (params.scope.kind === "agent") {
      const row = await this.db.get<DalHelpers.RawKvRow>(
        `INSERT INTO agent_state_kv (
           tenant_id,
           agent_id,
           workspace_id,
           key,
           value_json,
           updated_at,
           updated_by_run_id,
           provenance_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, agent_id, workspace_id, key)
         DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at,
           updated_by_run_id = excluded.updated_by_run_id,
           provenance_json = excluded.provenance_json
         RETURNING *`,
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.key,
          valueJson,
          updatedAtIso,
          updatedByRunId,
          provenanceJson,
        ],
      );
      if (!row) {
        throw new Error("agent state kv upsert failed");
      }
      return dalHelpers.toKvEntry(row) as AgentStateKVEntry;
    }

    const item = await this.getItem({
      scope: params.scope,
      work_item_id: params.scope.work_item_id,
    });
    if (!item) {
      throw new Error("work_item_id is outside scope");
    }

    const row = await this.db.get<DalHelpers.RawKvRow>(
      `INSERT INTO work_item_state_kv (
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         key,
         value_json,
         updated_at,
         updated_by_run_id,
         provenance_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id, work_item_id, key)
       DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         updated_by_run_id = excluded.updated_by_run_id,
         provenance_json = excluded.provenance_json
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.work_item_id,
        params.key,
        valueJson,
        updatedAtIso,
        updatedByRunId,
        provenanceJson,
      ],
    );
    if (!row) {
      throw new Error("work item state kv upsert failed");
    }
    return dalHelpers.toKvEntry({
      ...row,
      work_item_id: params.scope.work_item_id,
    }) as WorkItemStateKVEntry;
  }

  async createArtifact(params: {
    scope: WorkScope;
    artifact: {
      work_item_id?: string;
      kind: WorkArtifactKind;
      title: string;
      body_md?: string;
      refs?: string[];
      confidence?: number;
      created_by_run_id?: string;
      created_by_subagent_id?: string;
      provenance_json?: unknown;
    };
    artifactId?: string;
    createdAtIso?: string;
  }): Promise<WorkArtifact> {
    const artifactId = params.artifactId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    if (params.artifact.work_item_id) {
      const item = await this.getItem({
        scope: params.scope,
        work_item_id: params.artifact.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.artifact.created_by_subagent_id) {
      const subagent = await this.getSubagent({
        scope: params.scope,
        subagent_id: params.artifact.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.db.get<DalHelpers.RawWorkArtifactRow>(
      `INSERT INTO work_artifacts (
         artifact_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         kind,
         title,
         body_md,
         refs_json,
         confidence,
         created_at,
         created_by_run_id,
         created_by_subagent_id,
         provenance_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        artifactId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.artifact.work_item_id ?? null,
        params.artifact.kind,
        params.artifact.title,
        params.artifact.body_md ?? null,
        JSON.stringify(params.artifact.refs ?? []),
        params.artifact.confidence ?? null,
        createdAtIso,
        params.artifact.created_by_run_id ?? null,
        params.artifact.created_by_subagent_id ?? null,
        params.artifact.provenance_json === undefined
          ? null
          : JSON.stringify(params.artifact.provenance_json),
      ],
    );
    if (!row) {
      throw new Error("work artifact insert failed");
    }
    return dalHelpers.toWorkArtifact(row);
  }

  async listArtifacts(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ artifacts: WorkArtifact[]; next_cursor?: string }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.work_item_id) {
      where.push("work_item_id = ?");
      values.push(params.work_item_id);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND artifact_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawWorkArtifactRow>(
      `SELECT *
       FROM work_artifacts
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, artifact_id DESC
       LIMIT ?`,
      values,
    );

    const artifacts = rows.map(dalHelpers.toWorkArtifact);
    const last = artifacts.at(-1);
    const next_cursor =
      artifacts.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.artifact_id })
        : undefined;

    return { artifacts, next_cursor };
  }

  async getArtifact(params: {
    scope: WorkScope;
    artifact_id: string;
  }): Promise<WorkArtifact | undefined> {
    const row = await this.db.get<DalHelpers.RawWorkArtifactRow>(
      `SELECT *
       FROM work_artifacts
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND artifact_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.artifact_id,
      ],
    );
    return row ? dalHelpers.toWorkArtifact(row) : undefined;
  }

  async createDecision(params: {
    scope: WorkScope;
    decision: {
      work_item_id?: string;
      question: string;
      chosen: string;
      alternatives?: string[];
      rationale_md: string;
      input_artifact_ids?: string[];
      created_by_run_id?: string;
      created_by_subagent_id?: string;
    };
    decisionId?: string;
    createdAtIso?: string;
  }): Promise<DecisionRecord> {
    const decisionId = params.decisionId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    if (params.decision.work_item_id) {
      const item = await this.getItem({
        scope: params.scope,
        work_item_id: params.decision.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.decision.created_by_subagent_id) {
      const subagent = await this.getSubagent({
        scope: params.scope,
        subagent_id: params.decision.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.db.get<DalHelpers.RawDecisionRow>(
      `INSERT INTO work_decisions (
         decision_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         question,
         chosen,
         alternatives_json,
         rationale_md,
         input_artifact_ids_json,
         created_at,
         created_by_run_id,
         created_by_subagent_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        decisionId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.decision.work_item_id ?? null,
        params.decision.question,
        params.decision.chosen,
        JSON.stringify(params.decision.alternatives ?? []),
        params.decision.rationale_md,
        JSON.stringify(params.decision.input_artifact_ids ?? []),
        createdAtIso,
        params.decision.created_by_run_id ?? null,
        params.decision.created_by_subagent_id ?? null,
      ],
    );
    if (!row) {
      throw new Error("work decision insert failed");
    }
    return dalHelpers.toDecisionRecord(row);
  }

  async getDecision(params: {
    scope: WorkScope;
    decision_id: string;
  }): Promise<DecisionRecord | undefined> {
    const row = await this.db.get<DalHelpers.RawDecisionRow>(
      `SELECT *
       FROM work_decisions
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND decision_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.decision_id,
      ],
    );
    return row ? dalHelpers.toDecisionRecord(row) : undefined;
  }

  async listDecisions(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ decisions: DecisionRecord[]; next_cursor?: string }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.work_item_id) {
      where.push("work_item_id = ?");
      values.push(params.work_item_id);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND decision_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawDecisionRow>(
      `SELECT *
       FROM work_decisions
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, decision_id DESC
       LIMIT ?`,
      values,
    );
    const decisions = rows.map(dalHelpers.toDecisionRecord);
    const last = decisions.at(-1);
    const next_cursor =
      decisions.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.decision_id })
        : undefined;

    return { decisions, next_cursor };
  }

  async createSignal(params: {
    scope: WorkScope;
    signal: {
      work_item_id?: string;
      trigger_kind: WorkSignalTriggerKind;
      trigger_spec_json: unknown;
      payload_json?: unknown;
      status?: WorkSignalStatus;
    };
    signalId?: string;
    createdAtIso?: string;
  }): Promise<WorkSignal> {
    const signalId = params.signalId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const status: WorkSignalStatus = params.signal.status ?? "active";

    if (params.signal.work_item_id) {
      const item = await this.getItem({
        scope: params.scope,
        work_item_id: params.signal.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    const row = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `INSERT INTO work_signals (
         signal_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         trigger_kind,
         trigger_spec_json,
         payload_json,
         status,
         created_at,
         last_fired_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        signalId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.signal.work_item_id ?? null,
        params.signal.trigger_kind,
        JSON.stringify(params.signal.trigger_spec_json ?? null),
        params.signal.payload_json === undefined
          ? null
          : JSON.stringify(params.signal.payload_json),
        status,
        createdAtIso,
        null,
      ],
    );
    if (!row) {
      throw new Error("work signal insert failed");
    }
    return dalHelpers.toWorkSignal(row);
  }

  async updateSignal(params: {
    scope: WorkScope;
    signal_id: string;
    patch: {
      trigger_spec_json?: unknown;
      payload_json?: unknown;
      status?: WorkSignalStatus;
    };
  }): Promise<WorkSignal | undefined> {
    const set: string[] = [];
    const values: unknown[] = [];

    if (params.patch.trigger_spec_json !== undefined) {
      set.push("trigger_spec_json = ?");
      values.push(JSON.stringify(params.patch.trigger_spec_json));
    }
    if (params.patch.payload_json !== undefined) {
      set.push("payload_json = ?");
      values.push(JSON.stringify(params.patch.payload_json));
    }
    if (params.patch.status !== undefined) {
      set.push("status = ?");
      values.push(params.patch.status);
    }

    if (set.length === 0) {
      const existing = await this.db.get<DalHelpers.RawWorkSignalRow>(
        `SELECT *
         FROM work_signals
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND signal_id = ?`,
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.signal_id,
        ],
      );
      return existing ? dalHelpers.toWorkSignal(existing) : undefined;
    }

    const row = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `UPDATE work_signals
       SET ${set.join(", ")}
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?
       RETURNING *`,
      [
        ...values,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.signal_id,
      ],
    );
    return row ? dalHelpers.toWorkSignal(row) : undefined;
  }

  async markSignalFired(params: {
    scope: WorkScope;
    signal_id: string;
    firedAtIso?: string;
    status?: WorkSignalStatus;
  }): Promise<WorkSignal | undefined> {
    const firedAtIso = params.firedAtIso ?? new Date().toISOString();
    const status: WorkSignalStatus = params.status ?? "fired";

    const row = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `UPDATE work_signals
       SET status = ?, last_fired_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?
       RETURNING *`,
      [
        status,
        firedAtIso,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.signal_id,
      ],
    );
    return row ? dalHelpers.toWorkSignal(row) : undefined;
  }

  async getSignal(params: {
    scope: WorkScope;
    signal_id: string;
  }): Promise<WorkSignal | undefined> {
    const row = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `SELECT *
       FROM work_signals
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.signal_id],
    );
    return row ? dalHelpers.toWorkSignal(row) : undefined;
  }

  async listSignals(params: {
    scope: WorkScope;
    work_item_id?: string;
    statuses?: WorkSignalStatus[];
    limit?: number;
    cursor?: string;
  }): Promise<{ signals: WorkSignal[]; next_cursor?: string }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.work_item_id) {
      where.push("work_item_id = ?");
      values.push(params.work_item_id);
    }

    if (params.statuses && params.statuses.length > 0) {
      where.push(`status IN (${params.statuses.map(() => "?").join(", ")})`);
      values.push(...params.statuses);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND signal_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawWorkSignalRow>(
      `SELECT *
       FROM work_signals
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, signal_id DESC
       LIMIT ?`,
      values,
    );

    const signals = rows.map(dalHelpers.toWorkSignal);
    const last = signals.at(-1);
    const next_cursor =
      signals.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.signal_id })
        : undefined;

    return { signals, next_cursor };
  }

  async upsertScopeActivity(params: {
    scope: WorkScope;
    last_active_session_key: string;
    updated_at_ms?: number;
  }): Promise<DalHelpers.WorkScopeActivityRow> {
    const updatedAtMs = params.updated_at_ms ?? Date.now();
    const row = await this.db.get<DalHelpers.RawScopeActivityRow>(
      `INSERT INTO work_scope_activity (
         tenant_id,
         agent_id,
         workspace_id,
         last_active_session_key,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id)
       DO UPDATE SET
         last_active_session_key = excluded.last_active_session_key,
         updated_at_ms = excluded.updated_at_ms
       WHERE excluded.updated_at_ms > work_scope_activity.updated_at_ms
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.last_active_session_key,
        updatedAtMs,
      ],
    );
    if (row) return row;

    const existing = await this.getScopeActivity({ scope: params.scope });
    if (!existing) {
      throw new Error("work scope activity upsert failed");
    }
    return existing;
  }

  async getScopeActivity(params: {
    scope: WorkScope;
  }): Promise<DalHelpers.WorkScopeActivityRow | undefined> {
    return await this.db.get<DalHelpers.RawScopeActivityRow>(
      `SELECT *
       FROM work_scope_activity
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id],
    );
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

    return await this.db.transaction(async (tx) => {
      const owner = await tx.get<{ work_item_id: string }>(
        `SELECT work_item_id
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
      if (!owner) {
        throw new Error("work item not found for link");
      }

      const target = await tx.get<{ work_item_id: string }>(
        `SELECT work_item_id
         FROM work_items
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND work_item_id = ?`,
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.linked_work_item_id,
        ],
      );
      if (!target) {
        throw new Error("linked work item not found for link");
      }

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
    const rows = await this.db.all<DalHelpers.RawWorkItemLinkRow>(
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

  async createTask(params: {
    scope: WorkScope;
    task: {
      work_item_id: string;
      status?: WorkItemTaskState;
      depends_on?: string[];
      execution_profile: string;
      side_effect_class: string;
      run_id?: string;
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
    const status: WorkItemTaskState = params.task.status ?? "queued";
    const dependsOn = dalHelpers.normalizeTaskDeps(params.task.depends_on);

    if (dependsOn.includes(taskId)) {
      throw new Error("work item task depends_on cannot include itself");
    }

    const item = await this.getItem({
      scope: params.scope,
      work_item_id: params.task.work_item_id,
    });
    if (!item) {
      throw new Error("work item not found for task");
    }
    if (dalHelpers.isTerminalWorkItemState(item.status)) {
      throw new Error(`cannot create task for terminal work item (${item.status})`);
    }

    if (dependsOn.length > 0) {
      const placeholders = dependsOn.map(() => "?").join(", ");
      const rows = await this.db.all<{ task_id: string; work_item_id: string }>(
        `SELECT t.task_id, t.work_item_id
         FROM work_item_tasks t
         JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
         WHERE i.tenant_id = ?
           AND i.agent_id = ?
           AND i.workspace_id = ?
           AND t.task_id IN (${placeholders})`,
        [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, ...dependsOn],
      );
      const byId = new Map(rows.map((r) => [r.task_id, r]));
      for (const depId of dependsOn) {
        const dep = byId.get(depId);
        if (!dep) {
          throw new Error(`depends_on task not found: ${depId}`);
        }
        if (dep.work_item_id !== params.task.work_item_id) {
          throw new Error("depends_on task is outside work_item_id");
        }
      }
    }

    const row = await this.db.get<DalHelpers.RawWorkItemTaskRow>(
      `INSERT INTO work_item_tasks (
         tenant_id,
         task_id,
         work_item_id,
         status,
         depends_on_json,
         execution_profile,
         side_effect_class,
         run_id,
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
        params.scope.tenant_id,
        taskId,
        params.task.work_item_id,
        status,
        JSON.stringify(dependsOn),
        params.task.execution_profile,
        params.task.side_effect_class,
        params.task.run_id ?? null,
        params.task.approval_id ?? null,
        JSON.stringify(params.task.artifacts ?? []),
        params.task.started_at ?? null,
        params.task.finished_at ?? null,
        params.task.result_summary ?? null,
        createdAtIso,
        createdAtIso,
      ],
    );
    if (!row) {
      throw new Error("work item task insert failed");
    }
    return dalHelpers.toWorkItemTask(row);
  }

  async listTasks(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItemTask[]> {
    const rows = await this.db.all<DalHelpers.RawWorkItemTaskRow>(
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

  async updateTask(params: {
    scope: WorkScope;
    task_id: string;
    lease_owner?: string;
    nowMs?: number;
    patch: {
      status?: WorkItemTaskState;
      depends_on?: string[];
      execution_profile?: string;
      side_effect_class?: string;
      run_id?: string | null;
      approval_id?: string | null;
      artifacts?: unknown[];
      started_at?: string | null;
      finished_at?: string | null;
      result_summary?: string | null;
    };
    updatedAtIso?: string;
  }): Promise<WorkItemTask | undefined> {
    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<DalHelpers.RawWorkItemTaskRow>(
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
      if (!existing) return undefined;

      const nowMs = params.nowMs ?? Date.now();
      const existingStatus = existing.status as WorkItemTaskState;
      const leavingLease =
        existingStatus === "leased" &&
        params.patch.status !== undefined &&
        params.patch.status !== "leased";

      if (leavingLease) {
        const leaseOwner = params.lease_owner?.trim();
        if (!leaseOwner) {
          throw new Error("lease_owner is required to update leased tasks");
        }
        if ((existing.lease_owner ?? null) !== leaseOwner) {
          throw new Error("lease_owner mismatch");
        }
        const expiresAt = existing.lease_expires_at_ms ?? null;
        if (expiresAt === null || expiresAt <= nowMs) {
          throw new Error("task lease expired");
        }
      }

      const normalizedDependsOn =
        params.patch.depends_on !== undefined
          ? dalHelpers.normalizeTaskDeps(params.patch.depends_on)
          : undefined;

      if (normalizedDependsOn && normalizedDependsOn.includes(params.task_id)) {
        throw new Error("work item task depends_on cannot include itself");
      }

      if (normalizedDependsOn !== undefined) {
        if (normalizedDependsOn.length > 0) {
          const placeholders = normalizedDependsOn.map(() => "?").join(", ");
          const rows = await tx.all<{ task_id: string; work_item_id: string }>(
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
              ...normalizedDependsOn,
            ],
          );
          const byId = new Map(rows.map((r) => [r.task_id, r]));
          for (const depId of normalizedDependsOn) {
            const dep = byId.get(depId);
            if (!dep) {
              throw new Error(`depends_on task not found: ${depId}`);
            }
            if (dep.work_item_id !== existing.work_item_id) {
              throw new Error("depends_on task is outside work_item_id");
            }
          }
        }

        const allTasks = await tx.all<{ task_id: string; depends_on_json: string }>(
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
            existing.work_item_id,
          ],
        );

        const adj = new Map<string, string[]>();
        for (const row of allTasks) {
          adj.set(row.task_id, dalHelpers.parseTaskDepsJson(row.depends_on_json));
        }
        adj.set(params.task_id, normalizedDependsOn);

        if (dalHelpers.hasTaskDependencyCycle(adj)) {
          throw new Error("task dependency cycle detected");
        }
      }

      const set: string[] = [];
      const values: unknown[] = [];

      if (params.patch.status !== undefined) {
        set.push("status = ?");
        values.push(params.patch.status);
      }
      if (leavingLease) {
        set.push("lease_owner = NULL");
        set.push("lease_expires_at_ms = NULL");
      }
      if (normalizedDependsOn !== undefined) {
        set.push("depends_on_json = ?");
        values.push(JSON.stringify(normalizedDependsOn));
      }
      if (params.patch.execution_profile !== undefined) {
        set.push("execution_profile = ?");
        values.push(params.patch.execution_profile);
      }
      if (params.patch.side_effect_class !== undefined) {
        set.push("side_effect_class = ?");
        values.push(params.patch.side_effect_class);
      }
      if (params.patch.run_id !== undefined) {
        set.push("run_id = ?");
        values.push(params.patch.run_id);
      }
      if (params.patch.approval_id !== undefined) {
        set.push("approval_id = ?");
        values.push(params.patch.approval_id);
      }
      if (params.patch.artifacts !== undefined) {
        set.push("artifacts_json = ?");
        values.push(JSON.stringify(params.patch.artifacts));
      }
      if (params.patch.started_at !== undefined) {
        set.push("started_at = ?");
        values.push(params.patch.started_at);
      }
      if (params.patch.finished_at !== undefined) {
        set.push("finished_at = ?");
        values.push(params.patch.finished_at);
      }
      if (params.patch.result_summary !== undefined) {
        set.push("result_summary = ?");
        values.push(params.patch.result_summary);
      }

      if (set.length === 0) return dalHelpers.toWorkItemTask(existing);

      set.push("updated_at = ?");
      values.push(updatedAtIso);

      const row = await tx.get<DalHelpers.RawWorkItemTaskRow>(
        `UPDATE work_item_tasks
         SET ${set.join(", ")}
         WHERE tenant_id = ?
           AND task_id = ?
         RETURNING *`,
        [...values, params.scope.tenant_id, params.task_id],
      );
      if (!row) return undefined;

      const updated = dalHelpers.toWorkItemTask(row);
      const previousStatus = existing.status as WorkItemTaskState;

      if (updated.status !== previousStatus) {
        if (updated.status === "running") {
          if (updated.run_id) {
            await this.enqueueWsEventTx(tx, {
              event_id: randomUUID(),
              type: "work.task.started",
              occurred_at: updatedAtIso,
              scope: { kind: "agent", agent_id: params.scope.agent_id },
              payload: {
                ...params.scope,
                work_item_id: updated.work_item_id,
                task_id: updated.task_id,
                run_id: updated.run_id,
              },
            });
          }
        } else if (updated.status === "paused") {
          if (updated.approval_id) {
            await this.enqueueWsEventTx(tx, {
              event_id: randomUUID(),
              type: "work.task.paused",
              occurred_at: updatedAtIso,
              scope: { kind: "agent", agent_id: params.scope.agent_id },
              payload: {
                ...params.scope,
                work_item_id: updated.work_item_id,
                task_id: updated.task_id,
                approval_id: updated.approval_id,
              },
            });
          }
        } else if (updated.status === "completed") {
          await this.enqueueWsEventTx(tx, {
            event_id: randomUUID(),
            type: "work.task.completed",
            occurred_at: updatedAtIso,
            scope: { kind: "agent", agent_id: params.scope.agent_id },
            payload: {
              ...params.scope,
              work_item_id: updated.work_item_id,
              task_id: updated.task_id,
              ...(updated.result_summary ? { result_summary: updated.result_summary } : {}),
            },
          });
        }
      }

      return updated;
    });
  }

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

    const item = await this.getItem({ scope: params.scope, work_item_id: params.work_item_id });
    if (!item) {
      throw new Error("work item not found for lease");
    }
    if (dalHelpers.isTerminalWorkItemState(item.status)) {
      throw new Error(`cannot lease tasks for terminal work item (${item.status})`);
    }

    return await this.db.transaction(async (tx) => {
      const rows = await tx.all<DalHelpers.RawWorkItemTaskRow>(
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

      const statusById = new Map<string, WorkItemTaskState>();
      const depsById = new Map<string, string[]>();
      for (const row of rows) {
        statusById.set(row.task_id, row.status as WorkItemTaskState);
        depsById.set(row.task_id, dalHelpers.parseTaskDepsJson(row.depends_on_json));
      }

      const isTerminal = (s: WorkItemTaskState | undefined): boolean => {
        return s === "completed" || s === "skipped" || s === "cancelled" || s === "failed";
      };

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
        if (deps.length === 0) {
          runnable.push(row.task_id);
          continue;
        }
        let ok = true;
        for (const depId of deps) {
          const depStatus = statusById.get(depId);
          if (!isTerminal(depStatus)) {
            ok = false;
            break;
          }
        }
        if (ok) runnable.push(row.task_id);
      }

      const leased: Array<{ task: WorkItemTask; lease_expires_at_ms: number }> = [];
      for (const taskId of runnable.slice(0, limit)) {
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
          [
            params.lease_owner,
            leaseExpiresAtMs,
            updatedAtIso,
            params.scope.tenant_id,
            taskId,
            nowMs,
          ],
        );
        if (!updated) continue;
        leased.push({
          task: dalHelpers.toWorkItemTask(updated),
          lease_expires_at_ms: leaseExpiresAtMs,
        });
      }

      for (const entry of leased) {
        await this.enqueueWsEventTx(tx, {
          event_id: randomUUID(),
          type: "work.task.leased",
          occurred_at: updatedAtIso,
          scope: { kind: "agent", agent_id: params.scope.agent_id },
          payload: {
            ...params.scope,
            work_item_id: params.work_item_id,
            task_id: entry.task.task_id,
            lease_expires_at_ms: entry.lease_expires_at_ms,
          },
        });
      }

      return { leased };
    });
  }

  async createSubagent(params: {
    scope: WorkScope;
    subagent: {
      work_item_id?: string;
      work_item_task_id?: string;
      execution_profile: string;
      session_key: string;
      lane?: Lane;
      status?: SubagentStatus;
    };
    subagentId?: string;
    createdAtIso?: string;
  }): Promise<SubagentDescriptor> {
    const subagentId = params.subagentId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const lane: Lane = params.subagent.lane ?? "subagent";
    const status: SubagentStatus = params.subagent.status ?? "running";

    const explicitWorkItemId = params.subagent.work_item_id;
    let inferredWorkItemId: string | undefined;

    if (params.subagent.work_item_task_id) {
      const task = await this.db.get<{
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
        [
          params.scope.tenant_id,
          params.scope.agent_id,
          params.scope.workspace_id,
          params.subagent.work_item_task_id,
        ],
      );
      if (!task) {
        throw new Error("work_item_task_id is outside scope");
      }
      if (dalHelpers.isTerminalWorkItemState(task.work_item_status)) {
        throw new Error(`cannot create subagent for terminal work item (${task.work_item_status})`);
      }
      inferredWorkItemId = task.work_item_id;
    }

    if (explicitWorkItemId) {
      const item = await this.getItem({ scope: params.scope, work_item_id: explicitWorkItemId });
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

    const workItemId = explicitWorkItemId ?? inferredWorkItemId ?? null;

    const row = await this.db.get<DalHelpers.RawSubagentRow>(
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
         created_at,
         updated_at,
         last_heartbeat_at,
         closed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        subagentId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        workItemId,
        params.subagent.work_item_task_id ?? null,
        params.subagent.execution_profile,
        params.subagent.session_key,
        lane,
        status,
        createdAtIso,
        createdAtIso,
        null,
        null,
      ],
    );
    if (!row) {
      throw new Error("subagent insert failed");
    }
    return dalHelpers.toSubagent(row);
  }

  async heartbeatSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    heartbeatAtIso?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const heartbeatAtIso = params.heartbeatAtIso ?? new Date().toISOString();
    const row = await this.db.get<DalHelpers.RawSubagentRow>(
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
    const row = await this.db.get<DalHelpers.RawSubagentRow>(
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

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(updated_at < ? OR (updated_at = ? AND subagent_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawSubagentRow>(
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

  private async setSubagentTerminalStatus(params: {
    scope: WorkScope;
    subagent_id: string;
    status: "closing" | "failed";
    occurredAtIso: string;
    reason?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const closeReason = params.reason?.trim() || null;

    return await this.db.transaction(async (tx) => {
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
    return await this.setSubagentTerminalStatus({
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

    return await this.db.transaction(async (tx) => {
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
    return await this.setSubagentTerminalStatus({
      scope: params.scope,
      subagent_id: params.subagent_id,
      status: "failed",
      occurredAtIso: nowIso,
      reason: params.reason,
    });
  }
}
