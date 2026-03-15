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
         updated_at,
         last_fired_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    updatedAtIso?: string;
  }): Promise<{ signal: WorkSignal; changed: boolean } | undefined> {
    const existing = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `SELECT *
       FROM work_signals
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.signal_id],
    );
    if (!existing) return undefined;

    const set: string[] = [];
    const values: unknown[] = [];

    if (params.patch.trigger_spec_json !== undefined) {
      const triggerSpecJson = JSON.stringify(params.patch.trigger_spec_json);
      if (triggerSpecJson !== existing.trigger_spec_json) {
        set.push("trigger_spec_json = ?");
        values.push(triggerSpecJson);
      }
    }
    if (params.patch.payload_json !== undefined) {
      const payloadJson = JSON.stringify(params.patch.payload_json);
      if (payloadJson !== existing.payload_json) {
        set.push("payload_json = ?");
        values.push(payloadJson);
      }
    }
    if (params.patch.status !== undefined) {
      if (params.patch.status !== existing.status) {
        set.push("status = ?");
        values.push(params.patch.status);
      }
    }

    if (set.length === 0) {
      return {
        signal: dalHelpers.toWorkSignal(existing),
        changed: false,
      };
    }

    set.push("updated_at = ?");
    values.push(params.updatedAtIso ?? new Date().toISOString());

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
    return row
      ? {
          signal: dalHelpers.toWorkSignal(row),
          changed: true,
        }
      : undefined;
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
       SET status = ?, last_fired_at = ?, updated_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?
       RETURNING *`,
      [
        status,
        firedAtIso,
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

  async deleteSignal(params: {
    scope: WorkScope;
    signal_id: string;
  }): Promise<WorkSignal | undefined> {
    const row = await this.db.get<DalHelpers.RawWorkSignalRow>(
      `DELETE FROM work_signals
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND signal_id = ?
       RETURNING *`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.signal_id],
    );
    return row ? dalHelpers.toWorkSignal(row) : undefined;
  }
}
