import type { SqlDb } from "../../statestore/types.js";

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

  async get(input: { key: string; lane: string }): Promise<LaneQueueModeOverrideRow | undefined> {
    const row = await this.db.get<RawLaneQueueModeOverrideRow>(
      `SELECT key, lane, queue_mode, updated_at_ms
       FROM lane_queue_mode_overrides
       WHERE key = ? AND lane = ?`,
      [input.key, input.lane],
    );
    if (!row) return undefined;
    return {
      key: row.key,
      lane: row.lane,
      queue_mode: row.queue_mode,
      updated_at_ms: asNumber(row.updated_at_ms),
    };
  }

  async upsert(input: { key: string; lane: string; queueMode: string }): Promise<LaneQueueModeOverrideRow> {
    const nowMs = Date.now();
    await this.db.run(
      `INSERT INTO lane_queue_mode_overrides (key, lane, queue_mode, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key, lane) DO UPDATE SET
         queue_mode = excluded.queue_mode,
         updated_at_ms = excluded.updated_at_ms`,
      [input.key, input.lane, input.queueMode, nowMs],
    );

    const row = await this.get({ key: input.key, lane: input.lane });
    if (!row) {
      throw new Error("lane queue mode override upsert failed");
    }
    return row;
  }

  async clear(input: { key: string; lane: string }): Promise<boolean> {
    const res = await this.db.run(
      "DELETE FROM lane_queue_mode_overrides WHERE key = ? AND lane = ?",
      [input.key, input.lane],
    );
    return res.changes === 1;
  }
}

