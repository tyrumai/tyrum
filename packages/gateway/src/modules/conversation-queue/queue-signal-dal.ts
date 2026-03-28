import type { SqlDb } from "../../statestore/types.js";

export type ConversationQueueSignalKind = "steer" | "interrupt";

export type ConversationQueueSignal = {
  tenant_id: string;
  key: string;
  kind: ConversationQueueSignalKind;
  inbox_id: number | null;
  queue_mode: string;
  message_text: string;
  created_at_ms: number;
};

type RawConversationQueueSignal = {
  tenant_id: string;
  key: string;
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

export class ConversationQueueInterruptError extends Error {
  constructor(message = "conversation queue interrupted") {
    super(message);
    this.name = "ConversationQueueInterruptError";
  }
}

export class ConversationQueueSignalDal {
  constructor(private readonly db: SqlDb) {}

  async setSignal(input: {
    tenant_id: string;
    key: string;
    kind: ConversationQueueSignalKind;
    inbox_id: number | null;
    queue_mode: string;
    message_text: string;
    created_at_ms: number;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO conversation_queue_signals (
         tenant_id,
         conversation_key,
         kind,
         inbox_id,
         queue_mode,
         message_text,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key) DO UPDATE SET
         kind = excluded.kind,
         inbox_id = excluded.inbox_id,
         queue_mode = excluded.queue_mode,
         message_text = excluded.message_text,
         created_at_ms = excluded.created_at_ms`,
      [
        input.tenant_id,
        input.key,
        input.kind,
        input.inbox_id,
        input.queue_mode,
        input.message_text,
        input.created_at_ms,
      ],
    );
  }

  async clearSignal(input: { tenant_id: string; key: string }): Promise<void> {
    await this.db.run(
      "DELETE FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
      [input.tenant_id, input.key],
    );
  }

  async claimSignal(input: {
    tenant_id: string;
    key: string;
  }): Promise<ConversationQueueSignal | undefined> {
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawConversationQueueSignal>(
        `SELECT
           tenant_id,
           conversation_key AS key,
           kind,
           inbox_id,
           queue_mode,
           message_text,
           created_at_ms
         FROM conversation_queue_signals
         WHERE tenant_id = ? AND conversation_key = ?`,
        [input.tenant_id, input.key],
      );
      if (!row) return undefined;

      await tx.run(
        "DELETE FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
        [input.tenant_id, input.key],
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
        kind: row.kind === "interrupt" ? "interrupt" : "steer",
        inbox_id: row.inbox_id,
        queue_mode: row.queue_mode,
        message_text: row.message_text,
        created_at_ms: asNumber(row.created_at_ms),
      };
    });
  }
}
