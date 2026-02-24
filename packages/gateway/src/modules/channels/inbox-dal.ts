import type { SqlDb } from "../../statestore/types.js";
import { buildChannelSourceKey, DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "./interface.js";

export type ChannelInboxStatus = "queued" | "processing" | "completed" | "failed";

const DEFAULT_INBOUND_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INBOUND_DEDUPE_TTL_ENV = "TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS";

function inboundDedupeTtlMs(): number {
  const raw = process.env[INBOUND_DEDUPE_TTL_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_INBOUND_DEDUPE_TTL_MS;
}

function sourceVariantsForChannelAccount(channel: string, accountId: string): string[] {
  const canonical = buildChannelSourceKey({ connector: channel, accountId });
  if (accountId === DEFAULT_CHANNEL_ACCOUNT_ID) {
    return canonical === channel ? [channel] : [channel, canonical];
  }
  return [canonical];
}

export interface ChannelInboxRow {
  inbox_id: number;
  source: string;
  thread_id: string;
  message_id: string;
  key: string;
  lane: string;
  queue_mode: string;
  received_at_ms: number;
  payload: unknown;
  status: ChannelInboxStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  processed_at: string | null;
  error: string | null;
  reply_text: string | null;
}

interface RawChannelInboxRow {
  inbox_id: number;
  source: string;
  thread_id: string;
  message_id: string;
  key: string;
  lane: string;
  queue_mode: string;
  received_at_ms: number;
  payload_json: string;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  processed_at: string | Date | null;
  error: string | null;
  reply_text: string | null;
}

interface RawChannelInboundDedupeRow {
  channel: string;
  account_id: string;
  container_id: string;
  message_id: string;
  inbox_id: number | null;
  expires_at_ms: number;
}

function normalizeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function safeJsonParse(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function toRow(raw: RawChannelInboxRow): ChannelInboxRow {
  return {
    inbox_id: raw.inbox_id,
    source: raw.source,
    thread_id: raw.thread_id,
    message_id: raw.message_id,
    key: raw.key,
    lane: raw.lane,
    queue_mode: raw.queue_mode,
    received_at_ms: raw.received_at_ms,
    payload: safeJsonParse(raw.payload_json, {}),
    status: raw.status as ChannelInboxStatus,
    attempt: raw.attempt,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    processed_at: normalizeTime(raw.processed_at),
    error: raw.error,
    reply_text: raw.reply_text,
  };
}

export class ChannelInboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueue(input: {
    source: string;
    thread_id: string;
    message_id: string;
    key: string;
    lane: string;
    queue_mode?: string;
    received_at_ms: number;
    payload: unknown;
  }): Promise<{ row: ChannelInboxRow; deduped: boolean }> {
    const payloadJson = JSON.stringify(input.payload ?? {});
    const receivedAtMs = input.received_at_ms;
    const ttlMs = inboundDedupeTtlMs();
    const expiresAtMs = receivedAtMs + Math.max(1, ttlMs);

    const source = input.source.trim();
    const address = parseChannelSourceKey(source);
    const channel = address.connector;
    const accountId = address.accountId;
    const containerId = input.thread_id.trim();
    const messageId = input.message_id.trim();
    const queueMode = input.queue_mode?.trim() || "collect";

    return await this.db.transaction(async (tx) => {
      // Best-effort prune of expired keys to keep the dedupe table bounded.
      await tx.run(
        "DELETE FROM channel_inbound_dedupe WHERE expires_at_ms <= ?",
        [receivedAtMs],
      );

      const acquire = await tx.run(
        `INSERT INTO channel_inbound_dedupe (
           channel,
           account_id,
           container_id,
           message_id,
           inbox_id,
           expires_at_ms
         ) VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT (channel, account_id, container_id, message_id) DO UPDATE SET
           inbox_id = NULL,
           expires_at_ms = excluded.expires_at_ms
         WHERE channel_inbound_dedupe.expires_at_ms <= ?`,
        [channel, accountId, containerId, messageId, expiresAtMs, receivedAtMs],
      );

      if (acquire.changes !== 1) {
        const dedupeRow = await tx.get<RawChannelInboundDedupeRow>(
          `SELECT *
           FROM channel_inbound_dedupe
           WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
          [channel, accountId, containerId, messageId],
        );

        if (typeof dedupeRow?.inbox_id === "number" && Number.isFinite(dedupeRow.inbox_id)) {
          const existing = await tx.get<RawChannelInboxRow>(
            "SELECT * FROM channel_inbox WHERE inbox_id = ?",
            [dedupeRow.inbox_id],
          );
          if (existing) {
            return { row: toRow(existing), deduped: true };
          }
        }

        // Recovery fallback (should be rare): dedupe row exists but doesn't point
        // at an inbox row. Pick the newest matching inbox row and repair pointer.
        const sources = sourceVariantsForChannelAccount(channel, accountId);
        const placeholders = sources.map(() => "?").join(", ");
        const fallback = await tx.get<RawChannelInboxRow>(
          `SELECT *
           FROM channel_inbox
           WHERE source IN (${placeholders})
             AND thread_id = ?
             AND message_id = ?
           ORDER BY received_at_ms DESC, inbox_id DESC
           LIMIT 1`,
          [...sources, containerId, messageId],
        );
        if (fallback) {
          await tx.run(
            `UPDATE channel_inbound_dedupe
             SET inbox_id = ?
             WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
            [fallback.inbox_id, channel, accountId, containerId, messageId],
          );
          return { row: toRow(fallback), deduped: true };
        }

        // If we can't resolve the existing inbox row, treat this as a fresh enqueue.
        // This is safer than permanently rejecting inbound deliveries when state
        // is inconsistent.
      }

      // Backward-compat (and safety): if an inbox row already exists within the
      // TTL window, point the dedupe row at it instead of enqueueing a duplicate.
      const sources = sourceVariantsForChannelAccount(channel, accountId);
      const placeholders = sources.map(() => "?").join(", ");
      const cutoffMs = receivedAtMs - ttlMs;
      const existing = await tx.get<RawChannelInboxRow>(
        `SELECT *
         FROM channel_inbox
         WHERE source IN (${placeholders})
           AND thread_id = ?
           AND message_id = ?
           AND received_at_ms >= ?
         ORDER BY received_at_ms DESC, inbox_id DESC
         LIMIT 1`,
        [...sources, containerId, messageId, cutoffMs],
      );
      if (existing) {
        await tx.run(
          `UPDATE channel_inbound_dedupe
           SET inbox_id = ?
           WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
          [existing.inbox_id, channel, accountId, containerId, messageId],
        );
        return { row: toRow(existing), deduped: true };
      }

      let inboxId: number | undefined;
      if (tx.kind === "postgres") {
        const inserted = await tx.get<{ inbox_id: number }>(
          `INSERT INTO channel_inbox (
             source,
             thread_id,
             message_id,
             key,
             lane,
             queue_mode,
             received_at_ms,
             payload_json,
             status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')
           RETURNING inbox_id`,
          [
            source,
            containerId,
            messageId,
            input.key,
            input.lane,
            queueMode,
            receivedAtMs,
            payloadJson,
          ],
        );
        inboxId = inserted?.inbox_id;
      } else {
        await tx.run(
          `INSERT INTO channel_inbox (
             source,
             thread_id,
             message_id,
             key,
             lane,
             queue_mode,
             received_at_ms,
             payload_json,
             status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
          [
            source,
            containerId,
            messageId,
            input.key,
            input.lane,
            queueMode,
            receivedAtMs,
            payloadJson,
          ],
        );
        const inserted = await tx.get<{ inbox_id: number }>(
          "SELECT last_insert_rowid() AS inbox_id",
        );
        inboxId = inserted?.inbox_id;
      }

      if (typeof inboxId !== "number" || !Number.isFinite(inboxId)) {
        throw new Error("failed to enqueue inbound message");
      }

      await tx.run(
        `UPDATE channel_inbound_dedupe
         SET inbox_id = ?
         WHERE channel = ? AND account_id = ? AND container_id = ? AND message_id = ?`,
        [inboxId, channel, accountId, containerId, messageId],
      );

      const row = await tx.get<RawChannelInboxRow>(
        "SELECT * FROM channel_inbox WHERE inbox_id = ?",
        [inboxId],
      );
      if (!row) {
        throw new Error("failed to enqueue inbound message");
      }

      return { row: toRow(row), deduped: false };
    });
  }

  async getById(inboxId: number): Promise<ChannelInboxRow | undefined> {
    const row = await this.db.get<RawChannelInboxRow>(
      "SELECT * FROM channel_inbox WHERE inbox_id = ?",
      [inboxId],
    );
    return row ? toRow(row) : undefined;
  }

  async getByDedupeKey(input: {
    source: string;
    thread_id: string;
    message_id: string;
  }): Promise<ChannelInboxRow | undefined> {
    const row = await this.db.get<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE source = ? AND thread_id = ? AND message_id = ?
       ORDER BY received_at_ms DESC, inbox_id DESC
       LIMIT 1`,
      [input.source, input.thread_id, input.message_id],
    );
    return row ? toRow(row) : undefined;
  }

  async claimNext(input: {
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<ChannelInboxRow | undefined> {
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawChannelInboxRow>(
        `SELECT *
         FROM channel_inbox
         WHERE status = 'queued'
            OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
         ORDER BY received_at_ms ASC, inbox_id ASC
         LIMIT 1`,
        [input.now_ms],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE channel_inbox
         SET status = 'processing',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt = attempt + 1
         WHERE inbox_id = ?
           AND (
             status = 'queued'
             OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [input.owner, leaseExpiresAt, candidate.inbox_id, input.now_ms],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawChannelInboxRow>(
        "SELECT * FROM channel_inbox WHERE inbox_id = ?",
        [candidate.inbox_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async requeue(inboxId: number, owner: string): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'queued',
           lease_owner = NULL,
           lease_expires_at_ms = NULL
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [inboxId, owner],
    );
    return result.changes === 1;
  }

  async markCompleted(inboxId: number, owner: string, replyText: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = ?,
           error = NULL,
           reply_text = ?
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [nowIso, replyText, inboxId, owner],
    );
    return result.changes === 1;
  }

  async markFailed(inboxId: number, owner: string, error: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = ?,
           error = ?
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [nowIso, error, inboxId, owner],
    );
    return result.changes === 1;
  }

  async listQueuedForKey(input: {
    key: string;
    lane: string;
    received_at_ms_gte: number;
    received_at_ms_lte: number;
    limit: number;
  }): Promise<ChannelInboxRow[]> {
    if (input.limit <= 0) return [];
    const rows = await this.db.all<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE status = 'queued'
         AND key = ?
         AND lane = ?
         AND received_at_ms >= ?
         AND received_at_ms <= ?
       ORDER BY received_at_ms ASC, inbox_id ASC
       LIMIT ?`,
      [
        input.key,
        input.lane,
        input.received_at_ms_gte,
        input.received_at_ms_lte,
        Math.max(1, input.limit),
      ],
    );
    return rows.map(toRow);
  }

  async claimBatchByIds(input: {
    inbox_ids: number[];
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<number> {
    if (input.inbox_ids.length === 0) return 0;
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      let claimed = 0;
      for (const id of input.inbox_ids) {
        const updated = await tx.run(
          `UPDATE channel_inbox
           SET status = 'processing',
               lease_owner = ?,
               lease_expires_at_ms = ?,
               attempt = attempt + 1
           WHERE inbox_id = ? AND status = 'queued'`,
          [input.owner, leaseExpiresAt, id],
        );
        claimed += updated.changes;
      }
      return claimed;
    });
  }
}
