import type { SqlDb } from "../../statestore/types.js";
import type {
  ChannelInboundQueueOverflowPolicy,
  ChannelInboundQueueOverflowResult,
  ChannelInboxRow,
  RawChannelInboundDedupeRow,
  RawChannelInboxRow,
} from "./inbox-dal-types.js";
import {
  applyInboundQueueOverflowPolicy,
  toRow,
} from "./inbox-dal-helpers.js";

export type EnqueueTransactionInput = {
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  channelThreadId: string;
  channel: string;
  accountId: string;
  source: string;
  containerId: string;
  messageId: string;
  key: string;
  lane: string;
  queueMode: string;
  receivedAtMs: number;
  payloadJson: string;
  payload: unknown;
  ttlMs: number;
  expiresAtMs: number;
  cap: number;
  overflowPolicy: ChannelInboundQueueOverflowPolicy;
};

export async function executeEnqueueTransaction(
  tx: SqlDb,
  input: EnqueueTransactionInput,
): Promise<{
  row: ChannelInboxRow;
  deduped: boolean;
  overflow?: ChannelInboundQueueOverflowResult;
}> {
  const {
    tenantId,
    workspaceId,
    sessionId,
    channelThreadId,
    channel,
    accountId,
    source,
    containerId,
    messageId,
    key,
    lane,
    queueMode,
    receivedAtMs,
    payloadJson,
    payload,
    ttlMs,
    expiresAtMs,
    cap,
    overflowPolicy,
  } = input;

  // Best-effort prune of expired keys to keep the dedupe table bounded.
  await tx.run("DELETE FROM channel_inbound_dedupe WHERE expires_at_ms <= ?", [receivedAtMs]);

  const acquire = await tx.run(
    `INSERT INTO channel_inbound_dedupe (
       tenant_id,
       channel,
       account_id,
       container_id,
       message_id,
       inbox_id,
       expires_at_ms
     ) VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (tenant_id, channel, account_id, container_id, message_id) DO UPDATE SET
       inbox_id = NULL,
       expires_at_ms = excluded.expires_at_ms
     WHERE channel_inbound_dedupe.expires_at_ms <= ?`,
    [tenantId, channel, accountId, containerId, messageId, expiresAtMs, receivedAtMs],
  );

  if (acquire.changes !== 1) {
    const dedupeRow = await tx.get<RawChannelInboundDedupeRow>(
      `SELECT *
       FROM channel_inbound_dedupe
       WHERE tenant_id = ?
         AND channel = ?
         AND account_id = ?
         AND container_id = ?
         AND message_id = ?`,
      [tenantId, channel, accountId, containerId, messageId],
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
    const fallback = await tx.get<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE tenant_id = ?
         AND source = ?
         AND thread_id = ?
         AND message_id = ?
       ORDER BY received_at_ms DESC, inbox_id DESC
       LIMIT 1`,
      [tenantId, source, containerId, messageId],
    );
    if (fallback) {
      await tx.run(
        `UPDATE channel_inbound_dedupe
         SET inbox_id = ?
         WHERE tenant_id = ?
           AND channel = ?
           AND account_id = ?
           AND container_id = ?
           AND message_id = ?`,
        [fallback.inbox_id, tenantId, channel, accountId, containerId, messageId],
      );
      return { row: toRow(fallback), deduped: true };
    }

    // Queue-only semantics: if the message was previously processed and its
    // inbox row has been deleted, the dedupe row remains authoritative until
    // it expires. Treat this as deduped even when the inbox row is gone.
    const syntheticRow: ChannelInboxRow = {
      inbox_id:
        typeof dedupeRow?.inbox_id === "number" && Number.isFinite(dedupeRow.inbox_id)
          ? dedupeRow.inbox_id
          : 0,
      tenant_id: tenantId,
      source,
      thread_id: containerId,
      message_id: messageId,
      key,
      lane,
      queue_mode: queueMode,
      received_at_ms: receivedAtMs,
      payload: payload ?? {},
      status: "completed",
      attempt: 0,
      lease_owner: null,
      lease_expires_at_ms: null,
      processed_at: null,
      error: null,
      reply_text: null,
      workspace_id: workspaceId,
      session_id: sessionId,
      channel_thread_id: channelThreadId,
    };
    return { row: syntheticRow, deduped: true };
  }

  // Safety: if an inbox row already exists within the TTL window, point the
  // dedupe row at it instead of enqueueing a duplicate.
  const cutoffMs = receivedAtMs - ttlMs;
  const existing = await tx.get<RawChannelInboxRow>(
    `SELECT *
     FROM channel_inbox
     WHERE tenant_id = ?
       AND source = ?
       AND thread_id = ?
       AND message_id = ?
       AND received_at_ms >= ?
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    [tenantId, source, containerId, messageId, cutoffMs],
  );
  if (existing) {
    await tx.run(
      `UPDATE channel_inbound_dedupe
       SET inbox_id = ?
       WHERE tenant_id = ?
         AND channel = ?
         AND account_id = ?
         AND container_id = ?
         AND message_id = ?`,
      [existing.inbox_id, tenantId, channel, accountId, containerId, messageId],
    );
    return { row: toRow(existing), deduped: true };
  }

  let inboxId: number | undefined;
  if (tx.kind === "postgres") {
    const inserted = await tx.get<{ inbox_id: number }>(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         lane,
         queue_mode,
         received_at_ms,
         payload_json,
         status,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
       RETURNING inbox_id`,
      [
        tenantId,
        source,
        containerId,
        messageId,
        key,
        lane,
        queueMode,
        receivedAtMs,
        payloadJson,
        workspaceId,
        sessionId,
        channelThreadId,
      ],
    );
    inboxId = inserted?.inbox_id;
  } else {
    await tx.run(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         lane,
         queue_mode,
         received_at_ms,
         payload_json,
         status,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        tenantId,
        source,
        containerId,
        messageId,
        key,
        lane,
        queueMode,
        receivedAtMs,
        payloadJson,
        workspaceId,
        sessionId,
        channelThreadId,
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
     WHERE tenant_id = ?
       AND channel = ?
       AND account_id = ?
       AND container_id = ?
       AND message_id = ?`,
    [inboxId, tenantId, channel, accountId, containerId, messageId],
  );

  const row = await tx.get<RawChannelInboxRow>(
    "SELECT * FROM channel_inbox WHERE inbox_id = ?",
    [inboxId],
  );
  if (!row) {
    throw new Error("failed to enqueue inbound message");
  }

  const overflow = cap
    ? await applyInboundQueueOverflowPolicy(tx, {
        tenantId,
        workspaceId,
        sessionId,
        channelThreadId,
        key,
        lane,
        cap,
        policy: overflowPolicy,
      })
    : undefined;

  const finalRow = await tx.get<RawChannelInboxRow>(
    "SELECT * FROM channel_inbox WHERE inbox_id = ?",
    [inboxId],
  );
  if (!finalRow) {
    // Queue overflow policies may immediately drop the newest message (for example when
    // overflow policy is drop_newest or summarize_dropped). In that case the inserted row
    // can be deleted inside the same transaction. The inbound dedupe row remains
    // authoritative until it expires, so treat this as a successful enqueue that resulted
    // in a dropped/completed message.
    const syntheticRow: ChannelInboxRow = {
      inbox_id: inboxId,
      tenant_id: tenantId,
      source,
      thread_id: containerId,
      message_id: messageId,
      key,
      lane,
      queue_mode: queueMode,
      received_at_ms: receivedAtMs,
      payload: payload ?? {},
      status: "completed",
      attempt: 0,
      lease_owner: null,
      lease_expires_at_ms: null,
      processed_at: null,
      error: null,
      reply_text: null,
      workspace_id: workspaceId,
      session_id: sessionId,
      channel_thread_id: channelThreadId,
    };
    return { row: syntheticRow, deduped: false, overflow };
  }

  return { row: toRow(finalRow), deduped: false, overflow };
}
