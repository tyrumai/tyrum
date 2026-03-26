import type { SqlDb } from "../../statestore/types.js";

export type LaneQueueSignalKind = "steer" | "interrupt";

export type LaneQueueSignal = {
  tenant_id: string;
  key: string;
  lane: string;
  kind: LaneQueueSignalKind;
  inbox_id: number | null;
  queue_mode: string;
  message_text: string;
  created_at_ms: number;
};

type RawLaneQueueSignal = {
  tenant_id: string;
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
    tenant_id: string;
    key: string;
    lane: string;
    kind: LaneQueueSignalKind;
    inbox_id: number | null;
    queue_mode: string;
    message_text: string;
    created_at_ms: number;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO conversation_queue_signals (
         tenant_id,
         conversation_key,
         lane,
         kind,
         inbox_id,
         queue_mode,
         message_text,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key, lane) DO UPDATE SET
         kind = excluded.kind,
         inbox_id = excluded.inbox_id,
         queue_mode = excluded.queue_mode,
         message_text = excluded.message_text,
         created_at_ms = excluded.created_at_ms`,
      [
        input.tenant_id,
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

  async clearSignal(input: { tenant_id: string; key: string; lane: string }): Promise<void> {
    await this.db.run(
      "DELETE FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ? AND lane = ?",
      [input.tenant_id, input.key, input.lane],
    );
  }

  async claimSignal(input: {
    tenant_id: string;
    key: string;
    lane: string;
  }): Promise<LaneQueueSignal | undefined> {
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawLaneQueueSignal>(
        `SELECT
           tenant_id,
           conversation_key AS key,
           lane,
           kind,
           inbox_id,
           queue_mode,
           message_text,
           created_at_ms
         FROM conversation_queue_signals
         WHERE tenant_id = ? AND conversation_key = ? AND lane = ?`,
        [input.tenant_id, input.key, input.lane],
      );
      if (!row) return undefined;

      await tx.run(
        "DELETE FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ? AND lane = ?",
        [input.tenant_id, input.key, input.lane],
      );

      if (row.kind === "steer" && row.queue_mode === "steer" && typeof row.inbox_id === "number") {
        await tx.run(
          `DELETE FROM channel_inbox
           WHERE tenant_id = ?
             AND inbox_id = ?
             AND status IN ('queued', 'processing')`,
          [input.tenant_id, row.inbox_id],
        );
      }

      return {
        tenant_id: row.tenant_id,
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
