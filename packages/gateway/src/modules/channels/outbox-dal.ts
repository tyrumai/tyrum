import type { SqlDb } from "../../statestore/types.js";

export type ChannelOutboxStatus = "queued" | "sending" | "sent" | "failed";

export interface ChannelOutboxRow {
  outbox_id: number;
  inbox_id: number;
  source: string;
  thread_id: string;
  dedupe_key: string;
  chunk_index: number;
  text: string;
  parse_mode: string | null;
  status: ChannelOutboxStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  approval_id: number | null;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  response: unknown;
}

interface RawChannelOutboxRow {
  outbox_id: number;
  inbox_id: number;
  source: string;
  thread_id: string;
  dedupe_key: string;
  chunk_index: number;
  text: string;
  parse_mode: string | null;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  approval_id: number | null;
  created_at: string | Date;
  sent_at: string | Date | null;
  error: string | null;
  response_json: string | null;
}

function normalizeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function safeJsonParse(raw: string | null, fallback: unknown): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function toRow(raw: RawChannelOutboxRow): ChannelOutboxRow {
  return {
    outbox_id: raw.outbox_id,
    inbox_id: raw.inbox_id,
    source: raw.source,
    thread_id: raw.thread_id,
    dedupe_key: raw.dedupe_key,
    chunk_index: raw.chunk_index,
    text: raw.text,
    parse_mode: raw.parse_mode,
    status: raw.status as ChannelOutboxStatus,
    attempt: raw.attempt,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    approval_id: raw.approval_id,
    created_at: normalizeTime(raw.created_at) ?? new Date().toISOString(),
    sent_at: normalizeTime(raw.sent_at),
    error: raw.error,
    response: safeJsonParse(raw.response_json, null),
  };
}

export class ChannelOutboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueue(input: {
    inbox_id: number;
    source: string;
    thread_id: string;
    dedupe_key: string;
    chunk_index: number;
    text: string;
    parse_mode?: string;
  }): Promise<{ row: ChannelOutboxRow; deduped: boolean }> {
    const result = await this.db.run(
      `INSERT INTO channel_outbox (
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         chunk_index,
         text,
         parse_mode,
         status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        input.inbox_id,
        input.source,
        input.thread_id,
        input.dedupe_key,
        input.chunk_index,
        input.text,
        input.parse_mode ?? null,
      ],
    );

    const row = await this.getByDedupeKey(input.dedupe_key);
    if (!row) {
      throw new Error("failed to enqueue outbound message");
    }
    return { row, deduped: result.changes === 0 };
  }

  async getByDedupeKey(dedupeKey: string): Promise<ChannelOutboxRow | undefined> {
    const row = await this.db.get<RawChannelOutboxRow>(
      "SELECT * FROM channel_outbox WHERE dedupe_key = ?",
      [dedupeKey],
    );
    return row ? toRow(row) : undefined;
  }

  async listForInbox(inboxId: number): Promise<ChannelOutboxRow[]> {
    const rows = await this.db.all<RawChannelOutboxRow>(
      "SELECT * FROM channel_outbox WHERE inbox_id = ? ORDER BY chunk_index ASC, outbox_id ASC",
      [inboxId],
    );
    return rows.map(toRow);
  }

  async claimNextForInbox(input: {
    inbox_id: number;
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<ChannelOutboxRow | undefined> {
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawChannelOutboxRow>(
        `SELECT *
         FROM channel_outbox
         WHERE inbox_id = ?
           AND approval_id IS NULL
           AND (
             status = 'queued'
             OR (status = 'sending' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )
         ORDER BY chunk_index ASC, outbox_id ASC
         LIMIT 1`,
        [input.inbox_id, input.now_ms],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE channel_outbox
         SET status = 'sending',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt = attempt + 1
         WHERE outbox_id = ?
           AND approval_id IS NULL
           AND (
             status = 'queued'
             OR (status = 'sending' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [input.owner, leaseExpiresAt, candidate.outbox_id, input.now_ms],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawChannelOutboxRow>(
        "SELECT * FROM channel_outbox WHERE outbox_id = ?",
        [candidate.outbox_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async claimNextGlobal(input: {
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<ChannelOutboxRow | undefined> {
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawChannelOutboxRow>(
        `SELECT o.*
         FROM channel_outbox o
         WHERE o.approval_id IS NULL
           AND (
             o.status = 'queued'
             OR (o.status = 'sending' AND o.lease_expires_at_ms IS NOT NULL AND o.lease_expires_at_ms <= ?)
           )
           AND o.chunk_index = (
             SELECT MIN(o2.chunk_index)
             FROM channel_outbox o2
             WHERE o2.inbox_id = o.inbox_id
               AND o2.approval_id IS NULL
               AND (
                 o2.status = 'queued'
                 OR (o2.status = 'sending' AND o2.lease_expires_at_ms IS NOT NULL AND o2.lease_expires_at_ms <= ?)
               )
           )
         ORDER BY o.created_at ASC, o.outbox_id ASC
         LIMIT 1`,
        [input.now_ms, input.now_ms],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE channel_outbox
         SET status = 'sending',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt = attempt + 1
         WHERE outbox_id = ?
           AND approval_id IS NULL
           AND (
             status = 'queued'
             OR (status = 'sending' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [input.owner, leaseExpiresAt, candidate.outbox_id, input.now_ms],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawChannelOutboxRow>(
        "SELECT * FROM channel_outbox WHERE outbox_id = ?",
        [candidate.outbox_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async setApprovalForInbox(inboxId: number, approvalId: number): Promise<number> {
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET approval_id = ?
       WHERE inbox_id = ?
         AND status = 'queued'
         AND approval_id IS NULL`,
      [approvalId, inboxId],
    );
    return result.changes;
  }

  async clearApprovalById(approvalId: number): Promise<number> {
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET approval_id = NULL
       WHERE approval_id = ?
         AND status = 'queued'`,
      [approvalId],
    );
    return result.changes;
  }

  async markFailedByApproval(approvalId: number, error: string): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           sent_at = ?,
           error = ?
       WHERE approval_id = ?
         AND status != 'sent'`,
      [nowIso, error, approvalId],
    );
    return result.changes;
  }

  async markSent(outboxId: number, owner: string, response: unknown): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET status = 'sent',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           sent_at = ?,
           error = NULL,
           response_json = ?
       WHERE outbox_id = ? AND lease_owner = ? AND status = 'sending'`,
      [nowIso, JSON.stringify(response ?? null), outboxId, owner],
    );
    return result.changes === 1;
  }

  async markFailed(outboxId: number, owner: string, error: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           sent_at = ?,
           error = ?
       WHERE outbox_id = ? AND lease_owner = ? AND status = 'sending'`,
      [nowIso, error, outboxId, owner],
    );
    return result.changes === 1;
  }
}
