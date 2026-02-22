import type { SqlDb } from "../../statestore/types.js";

export type ChannelInboxStatus = "queued" | "processing" | "completed" | "failed";

export interface ChannelInboxRow {
  inbox_id: number;
  source: string;
  thread_id: string;
  message_id: string;
  key: string;
  lane: string;
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
    received_at_ms: number;
    payload: unknown;
  }): Promise<{ row: ChannelInboxRow; deduped: boolean }> {
    const payloadJson = JSON.stringify(input.payload ?? {});

    const result = await this.db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
       ON CONFLICT (source, thread_id, message_id) DO NOTHING`,
      [
        input.source,
        input.thread_id,
        input.message_id,
        input.key,
        input.lane,
        input.received_at_ms,
        payloadJson,
      ],
    );

    const row = await this.getByDedupeKey({
      source: input.source,
      thread_id: input.thread_id,
      message_id: input.message_id,
    });
    if (!row) {
      throw new Error("failed to enqueue inbound message");
    }
    return { row, deduped: result.changes === 0 };
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
       WHERE source = ? AND thread_id = ? AND message_id = ?`,
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
