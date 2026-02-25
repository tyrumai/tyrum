import type { SqlDb } from "../../statestore/types.js";

export type LaneQueueSignalKind = "steer" | "interrupt";

export type LaneQueueSignal = {
  key: string;
  lane: string;
  kind: LaneQueueSignalKind;
  inbox_id: number | null;
  queue_mode: string;
  message_text: string;
  created_at_ms: number;
};

type RawLaneQueueSignal = {
  key: string;
  lane: string;
  kind: string;
  inbox_id: number | null;
  queue_mode: string;
  message_text: string;
  created_at_ms: number | string;
};

function asNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class LaneQueueInterruptError extends Error {
  constructor(message = "lane queue interrupted") {
    super(message);
    this.name = "LaneQueueInterruptError";
  }
}

export class LaneQueueSignalDal {
  constructor(private readonly db: SqlDb) {}

  async setSignal(input: {
    key: string;
    lane: string;
    kind: LaneQueueSignalKind;
    inbox_id: number | null;
    queue_mode: string;
    message_text: string;
    created_at_ms: number;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO lane_queue_signals (
         key,
         lane,
         kind,
         inbox_id,
         queue_mode,
         message_text,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key, lane) DO UPDATE SET
         kind = excluded.kind,
         inbox_id = excluded.inbox_id,
         queue_mode = excluded.queue_mode,
         message_text = excluded.message_text,
         created_at_ms = excluded.created_at_ms`,
      [
        input.key,
        input.lane,
        input.kind,
        input.inbox_id,
        input.queue_mode,
        input.message_text,
        input.created_at_ms,
      ],
    );
  }

  async clearSignal(input: { key: string; lane: string }): Promise<void> {
    await this.db.run("DELETE FROM lane_queue_signals WHERE key = ? AND lane = ?", [
      input.key,
      input.lane,
    ]);
  }

  async claimSignal(input: { key: string; lane: string }): Promise<LaneQueueSignal | undefined> {
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawLaneQueueSignal>(
        `SELECT
           key,
           lane,
           kind,
           inbox_id,
           queue_mode,
           message_text,
           created_at_ms
         FROM lane_queue_signals
         WHERE key = ? AND lane = ?`,
        [input.key, input.lane],
      );
      if (!row) return undefined;

      await tx.run("DELETE FROM lane_queue_signals WHERE key = ? AND lane = ?", [
        input.key,
        input.lane,
      ]);

      if (row.kind === "steer" && row.queue_mode === "steer" && typeof row.inbox_id === "number") {
        await tx.run(
          `UPDATE channel_inbox
           SET status = 'completed',
               lease_owner = NULL,
               lease_expires_at_ms = NULL,
               processed_at = COALESCE(processed_at, ?),
               error = NULL,
               reply_text = COALESCE(reply_text, '')
           WHERE inbox_id = ? AND status IN ('queued', 'processing')`,
          [nowIso, row.inbox_id],
        );
      }

      return {
        key: row.key,
        lane: row.lane,
        kind: row.kind === "interrupt" ? "interrupt" : "steer",
        inbox_id: row.inbox_id,
        queue_mode: row.queue_mode,
        message_text: row.message_text,
        created_at_ms: asNumber(row.created_at_ms),
      };
    });
  }
}
