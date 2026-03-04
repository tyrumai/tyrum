import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";

export type ChannelOutboxStatus = "queued" | "sending" | "sent" | "failed";

export interface ChannelOutboxRow {
  outbox_id: number;
  tenant_id: string;
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
  approval_id: string | null;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  response: unknown;
  workspace_id: string;
  session_id: string;
  channel_thread_id: string;
}

interface RawChannelOutboxRow {
  outbox_id: number;
  tenant_id: string;
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
  approval_id: string | null;
  created_at: string | Date;
  sent_at: string | Date | null;
  error: string | null;
  response_json: string | null;
  workspace_id: string;
  session_id: string;
  channel_thread_id: string;
}

function normalizeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawChannelOutboxRow): ChannelOutboxRow {
  return {
    outbox_id: raw.outbox_id,
    tenant_id: raw.tenant_id,
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
    response: safeJsonParse(raw.response_json, null as unknown),
    workspace_id: raw.workspace_id,
    session_id: raw.session_id,
    channel_thread_id: raw.channel_thread_id,
  };
}

export class ChannelOutboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueue(input: {
    tenant_id: string;
    inbox_id: number;
    source: string;
    thread_id: string;
    dedupe_key: string;
    chunk_index: number;
    text: string;
    parse_mode?: string;
    approval_id?: string | null;
    workspace_id: string;
    session_id: string;
    channel_thread_id: string;
  }): Promise<{ row: ChannelOutboxRow; deduped: boolean }> {
    const result = await this.db.run(
      `INSERT INTO channel_outbox (
         tenant_id,
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         chunk_index,
         text,
         parse_mode,
         status,
         approval_id,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [
        input.tenant_id,
        input.inbox_id,
        input.source,
        input.thread_id,
        input.dedupe_key,
        input.chunk_index,
        input.text,
        input.parse_mode ?? null,
        input.approval_id ?? null,
        input.workspace_id,
        input.session_id,
        input.channel_thread_id,
      ],
    );

    const row = await this.getByDedupeKey({
      tenant_id: input.tenant_id,
      dedupe_key: input.dedupe_key,
    });
    if (!row) {
      throw new Error("failed to enqueue outbound message");
    }
    return { row, deduped: result.changes === 0 };
  }

  async getByDedupeKey(input: {
    tenant_id: string;
    dedupe_key: string;
  }): Promise<ChannelOutboxRow | undefined> {
    const row = await this.db.get<RawChannelOutboxRow>(
      "SELECT * FROM channel_outbox WHERE tenant_id = ? AND dedupe_key = ?",
      [input.tenant_id, input.dedupe_key],
    );
    return row ? toRow(row) : undefined;
  }

  async listForInbox(input: { tenant_id: string; inbox_id: number }): Promise<ChannelOutboxRow[]> {
    const rows = await this.db.all<RawChannelOutboxRow>(
      `SELECT *
       FROM channel_outbox
       WHERE tenant_id = ? AND inbox_id = ?
       ORDER BY chunk_index ASC, outbox_id ASC`,
      [input.tenant_id, input.inbox_id],
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

  async setApprovalForInbox(inboxId: number, approvalId: string): Promise<number> {
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

  async clearApprovalById(approvalId: string): Promise<number> {
    const result = await this.db.run(
      `UPDATE channel_outbox
       SET approval_id = NULL
       WHERE approval_id = ?
         AND status = 'queued'`,
      [approvalId],
    );
    return result.changes;
  }

  async markFailedByApproval(approvalId: string, error: string): Promise<number> {
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

  async markSent(input: { outboxId: number; inboxId: number; owner: string }): Promise<boolean> {
    const deleted = await this.db.run(
      `DELETE FROM channel_outbox
       WHERE outbox_id = ? AND lease_owner = ? AND status = 'sending'`,
      [input.outboxId, input.owner],
    );
    if (deleted.changes !== 1) return false;

    return true;
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
