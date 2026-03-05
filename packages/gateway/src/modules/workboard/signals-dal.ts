import { randomUUID } from "node:crypto";
import type {
  WorkScope,
  WorkSignal,
  WorkSignalStatus,
  WorkSignalTriggerKind,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

export class WorkboardSignalsDal {
  constructor(private readonly db: SqlDb) {}

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
      const row = await this.db.get<{ work_item_id: string }>(
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
          params.signal.work_item_id,
        ],
      );
      if (!row) {
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
}
