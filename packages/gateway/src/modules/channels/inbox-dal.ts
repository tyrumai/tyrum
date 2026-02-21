import type { SqlDb } from "../../statestore/types.js";

export type QueueOverflowPolicy = "drop_oldest" | "drop_newest" | "summarize_dropped";

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
  | {
      kind: "queued";
      dropped: number;
      overflowPolicy: QueueOverflowPolicy;
      summarized: boolean;
    }
  | {
      kind: "dropped";
      dropped: number;
      overflowPolicy: QueueOverflowPolicy;
      summarized: boolean;
    };

function normalizeOverflowPolicy(raw: QueueOverflowPolicy | undefined): QueueOverflowPolicy {
  switch (raw) {
    case "drop_oldest":
    case "drop_newest":
    case "summarize_dropped":
      return raw;
    default:
      return "drop_oldest";
  }
}

function normalizeSummaryMaxChars(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 2400;
  return Math.max(200, Math.min(20_000, Math.floor(raw)));
}

function safeTextPreview(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

export class ChannelInboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueueMessage(
    input: EnqueueInboundMessageInput,
    opts?: { cap?: number; overflow?: QueueOverflowPolicy; summarizeMaxChars?: number },
  ): Promise<EnqueueInboundMessageResult> {
    const cap = Math.max(1, Math.floor(opts?.cap ?? 50));
    const overflowPolicy = normalizeOverflowPolicy(opts?.overflow);
    const summaryMaxChars = normalizeSummaryMaxChars(
      opts?.summarizeMaxChars,
    );
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
        return { kind: "queued", dropped: 0, overflowPolicy, summarized: false };
      }

      const order = overflowPolicy === "drop_newest" ? "DESC" : "ASC";
      const toDrop = await tx.all<{ message_id: string }>(
        `SELECT message_id
         FROM channel_inbound_messages
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'
         ORDER BY received_at_ms ${order}
         LIMIT ?`,
        [input.channel, input.accountId, input.containerId, overflow],
      );

      const ids = toDrop.map((r) => r.message_id).filter((id) => typeof id === "string" && id.length > 0);
      if (ids.length === 0) {
        return { kind: "queued", dropped: 0, overflowPolicy, summarized: false };
      }

      const droppedSelf = ids.includes(input.messageId);

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
          `queue overflow (${overflowPolicy})`,
          input.channel,
          input.accountId,
          input.containerId,
          ...ids,
        ],
      );

      let summarized = false;
      if (overflowPolicy === "summarize_dropped") {
        try {
          const dropped = await tx.all<{
            message_id: string;
            text: string | null;
            has_attachment: number | boolean;
          }>(
            `SELECT message_id, text, has_attachment
             FROM channel_inbound_messages
             WHERE channel = ? AND account_id = ? AND container_id = ?
               AND message_id IN (${placeholders})`,
            [input.channel, input.accountId, input.containerId, ...ids],
          );

          const previews = dropped
            .map((row) => {
              const text = (row.text ?? "").trim();
              if (text.length > 0) return safeTextPreview(text, 120);
              const hasAttachment = tx.kind === "postgres" ? Boolean(row.has_attachment) : Number(row.has_attachment) === 1;
              return hasAttachment ? "[attachment]" : "[empty]";
            })
            .slice(0, 8);

          const carrierId = !droppedSelf
            ? input.messageId
            : (
                await tx.get<{ message_id: string }>(
                  `SELECT message_id
                   FROM channel_inbound_messages
                   WHERE channel = ? AND account_id = ? AND container_id = ?
                     AND status = 'pending'
                   ORDER BY received_at_ms DESC
                   LIMIT 1`,
                  [input.channel, input.accountId, input.containerId],
                )
              )?.message_id;

          if (carrierId) {
            const existing = await tx.get<{ text: string | null }>(
              `SELECT text FROM channel_inbound_messages
               WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
              [input.channel, input.accountId, input.containerId, carrierId],
            );
            const existingText = (existing?.text ?? "").trim();

            const header = `[QUEUE OVERFLOW] Dropped ${ids.length} message(s) (cap=${cap}).`;
            const body = previews.map((p) => `- ${p}`).join("\n");
            const summaryParts = [
              header,
              previews.length > 0 ? `Dropped previews:\n${body}` : "Dropped messages (no preview).",
              existingText.length > 0 ? `Newest message:\n${existingText}` : "",
            ].filter((p) => p.trim().length > 0);

            const summary = safeTextPreview(summaryParts.join("\n\n"), summaryMaxChars);
            await tx.run(
              `UPDATE channel_inbound_messages
               SET text = ?, updated_at = ?
               WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
              [summary, nowIso, input.channel, input.accountId, input.containerId, carrierId],
            );
            summarized = true;
          }
        } catch {
          summarized = false;
        }
      }

      const result = {
        dropped: ids.length,
        overflowPolicy,
        summarized,
      };
      return droppedSelf ? { kind: "dropped", ...result } : { kind: "queued", ...result };
    });
  }
}
