import type { SqlDb } from "../../statestore/types.js";

export type OutboundSendStatus =
  | "pending"
  | "awaiting_approval"
  | "sent"
  | "failed"
  | "denied";

export interface OutboundSendRow {
  id: string;
  channel: string;
  account_id: string;
  container_id: string;
  reply_to_message_id: string | null;
  body: string;
  idempotency_key: string;
  status: OutboundSendStatus;
  approval_id: number | null;
  send_attempt: number;
  last_error: string | null;
  receipt: unknown | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface RawOutboundSendRow {
  id: string;
  channel: string;
  account_id: string;
  container_id: string;
  reply_to_message_id: string | null;
  body: string;
  idempotency_key: string;
  status: string;
  approval_id: number | null;
  send_attempt: number;
  last_error: string | null;
  receipt_json: unknown | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function rowToSend(row: RawOutboundSendRow): OutboundSendRow {
  let receipt: unknown | null = null;
  if (row.receipt_json != null) {
    try {
      receipt =
        typeof row.receipt_json === "string"
          ? (JSON.parse(row.receipt_json) as unknown)
          : row.receipt_json;
    } catch {
      receipt = null;
    }
  }
  return {
    id: row.id,
    channel: row.channel,
    account_id: row.account_id,
    container_id: row.container_id,
    reply_to_message_id: row.reply_to_message_id,
    body: row.body,
    idempotency_key: row.idempotency_key,
    status: row.status as OutboundSendStatus,
    approval_id: row.approval_id,
    send_attempt: row.send_attempt,
    last_error: row.last_error,
    receipt,
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms,
  };
}

export class ChannelOutboxDal {
  constructor(private readonly db: SqlDb) {}

  async enqueueSend(input: {
    id: string;
    channel: string;
    accountId: string;
    containerId: string;
    replyToMessageId?: string;
    body: string;
    idempotencyKey: string;
    status: OutboundSendStatus;
    approvalId?: number;
    nowMs: number;
  }): Promise<{ inserted: boolean }> {
    const receiptSql =
      this.db.kind === "postgres"
        ? `INSERT INTO channel_outbound_sends (
             id, channel, account_id, container_id, reply_to_message_id,
             body, idempotency_key, status, approval_id,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (channel, account_id, container_id, idempotency_key) DO NOTHING`
        : `INSERT INTO channel_outbound_sends (
             id, channel, account_id, container_id, reply_to_message_id,
             body, idempotency_key, status, approval_id,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (channel, account_id, container_id, idempotency_key) DO NOTHING`;

    const res = await this.db.run(receiptSql, [
      input.id,
      input.channel,
      input.accountId,
      input.containerId,
      input.replyToMessageId ?? null,
      input.body,
      input.idempotencyKey,
      input.status,
      input.approvalId ?? null,
      input.nowMs,
      input.nowMs,
    ]);

    return { inserted: res.changes === 1 };
  }

  async listReadyToSend(limit: number, nowMs: number): Promise<OutboundSendRow[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    // "pending" sends are ready; "awaiting_approval" are ready when approval status is approved.
    const rows = await this.db.all<RawOutboundSendRow>(
      `SELECT s.*
       FROM channel_outbound_sends s
       LEFT JOIN approvals a ON a.id = s.approval_id
       WHERE
         (s.status = 'pending')
         OR (s.status = 'awaiting_approval' AND a.status = 'approved')
       ORDER BY s.created_at_ms ASC
       LIMIT ?`,
      [safeLimit],
    );

    // Opportunistically transition awaiting_approval -> denied when approval resolved non-approved.
    await this.db.run(
      `UPDATE channel_outbound_sends
       SET status = 'denied', updated_at_ms = ?, last_error = COALESCE(last_error, 'approval denied')
       WHERE status = 'awaiting_approval'
         AND approval_id IS NOT NULL
         AND approval_id IN (SELECT id FROM approvals WHERE status IN ('denied', 'expired'))`,
      [nowMs],
    );

    return rows.map(rowToSend);
  }

  async markSent(id: string, receipt: unknown, nowMs: number): Promise<void> {
    const receiptJson = JSON.stringify(receipt);
    const sql =
      this.db.kind === "postgres"
        ? `UPDATE channel_outbound_sends
           SET status = 'sent', updated_at_ms = ?, receipt_json = ?::jsonb
           WHERE id = ?`
        : `UPDATE channel_outbound_sends
           SET status = 'sent', updated_at_ms = ?, receipt_json = ?
           WHERE id = ?`;

    await this.db.run(sql, [nowMs, receiptJson, id]);
  }

  async markFailed(id: string, error: string, nowMs: number): Promise<void> {
    await this.db.run(
      `UPDATE channel_outbound_sends
       SET status = 'failed', updated_at_ms = ?, last_error = ?, send_attempt = send_attempt + 1
       WHERE id = ?`,
      [nowMs, error, id],
    );
  }
}
