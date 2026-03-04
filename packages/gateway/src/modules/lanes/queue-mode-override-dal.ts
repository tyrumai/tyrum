import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export type LaneQueueModeOverrideRow = {
  key: string;
  lane: string;
  queue_mode: string;
  updated_at_ms: number;
};

type RawLaneQueueModeOverrideRow = {
  key: string;
  lane: string;
  queue_mode: string;
  updated_at_ms: number | string;
};

function asNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class LaneQueueModeOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenant_id?: string;
    key: string;
    lane: string;
  }): Promise<LaneQueueModeOverrideRow | undefined> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const row = await this.db.get<RawLaneQueueModeOverrideRow>(
      `SELECT key, lane, queue_mode, updated_at_ms
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [tenantId, input.key, input.lane],
    );
    if (!row) return undefined;
    return {
      key: row.key,
      lane: row.lane,
      queue_mode: row.queue_mode,
      updated_at_ms: asNumber(row.updated_at_ms),
    };
  }

  async upsert(input: {
    tenant_id?: string;
    key: string;
    lane: string;
    queueMode: string;
  }): Promise<LaneQueueModeOverrideRow> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const nowMs = Date.now();
    await this.db.run(
      `INSERT INTO lane_queue_mode_overrides (tenant_id, key, lane, queue_mode, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, key, lane) DO UPDATE SET
         queue_mode = excluded.queue_mode,
         updated_at_ms = excluded.updated_at_ms`,
      [tenantId, input.key, input.lane, input.queueMode, nowMs],
    );

    const row = await this.get({ tenant_id: tenantId, key: input.key, lane: input.lane });
    if (!row) {
      throw new Error("lane queue mode override upsert failed");
    }
    return row;
  }

  async clear(input: { tenant_id?: string; key: string; lane: string }): Promise<boolean> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const res = await this.db.run(
      "DELETE FROM lane_queue_mode_overrides WHERE tenant_id = ? AND key = ? AND lane = ?",
      [tenantId, input.key, input.lane],
    );
    return res.changes === 1;
  }
}
