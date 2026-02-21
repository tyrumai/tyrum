import type { SqlDb } from "../../statestore/types.js";

export interface EnqueueInboundMessageInput {
  channel: string;
  accountId: string;
  containerId: string;
  messageId: string;
  threadKind: string;
  senderId?: string;
  senderIsBot: boolean;
  provenance: readonly string[];
  text?: string;
  hasAttachment: boolean;
  receivedAtMs: number;
}

export type EnqueueInboundMessageResult =
  | { kind: "deduped" }
  | { kind: "queued"; droppedOldest: number };

export class ChannelInboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueueMessage(
    input: EnqueueInboundMessageInput,
    opts?: { cap?: number },
  ): Promise<EnqueueInboundMessageResult> {
    const cap = Math.max(1, Math.floor(opts?.cap ?? 50));
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const provenanceJson = JSON.stringify(input.provenance);

      const insertSql =
        tx.kind === "postgres"
          ? `INSERT INTO channel_inbound_messages (
               channel,
               account_id,
               container_id,
               message_id,
               thread_kind,
               sender_id,
               sender_is_bot,
               provenance_json,
               text,
               has_attachment,
               received_at_ms,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, 'pending', ?, ?)
             ON CONFLICT (channel, account_id, container_id, message_id) DO NOTHING`
          : `INSERT INTO channel_inbound_messages (
               channel,
               account_id,
               container_id,
               message_id,
               thread_kind,
               sender_id,
               sender_is_bot,
               provenance_json,
               text,
               has_attachment,
               received_at_ms,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
             ON CONFLICT (channel, account_id, container_id, message_id) DO NOTHING`;

      const insert = await tx.run(insertSql, [
        input.channel,
        input.accountId,
        input.containerId,
        input.messageId,
        input.threadKind,
        input.senderId ?? null,
        tx.kind === "postgres" ? input.senderIsBot : input.senderIsBot ? 1 : 0,
        provenanceJson,
        input.text ?? null,
        tx.kind === "postgres" ? input.hasAttachment : input.hasAttachment ? 1 : 0,
        input.receivedAtMs,
        nowIso,
        nowIso,
      ]);

      if (insert.changes !== 1) {
        return { kind: "deduped" };
      }

      const row = await tx.get<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM channel_inbound_messages
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'`,
        [input.channel, input.accountId, input.containerId],
      );
      const pending = Number(row?.n ?? 0);
      const overflow = Math.max(0, pending - cap);
      if (overflow === 0) {
        return { kind: "queued", droppedOldest: 0 };
      }

      const oldest = await tx.all<{ message_id: string }>(
        `SELECT message_id
         FROM channel_inbound_messages
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'
         ORDER BY received_at_ms ASC
         LIMIT ?`,
        [input.channel, input.accountId, input.containerId, overflow],
      );

      const ids = oldest.map((r) => r.message_id).filter((id) => id && id !== input.messageId);
      if (ids.length === 0) {
        return { kind: "queued", droppedOldest: 0 };
      }

      const placeholders = ids.map(() => "?").join(", ");
      await tx.run(
        `UPDATE channel_inbound_messages
         SET status = 'dropped', processed_at_ms = ?, updated_at = ?, error = ?
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'
           AND message_id IN (${placeholders})`,
        [
          Date.now(),
          nowIso,
          "queue overflow (drop_oldest)",
          input.channel,
          input.accountId,
          input.containerId,
          ...ids,
        ],
      );

      return { kind: "queued", droppedOldest: ids.length };
    });
  }
}
