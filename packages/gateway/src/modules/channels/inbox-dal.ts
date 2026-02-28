import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  normalizedContainerKindFromThreadKind,
  parseTyrumKey,
} from "@tyrum/schemas";
import type { NormalizedThreadMessage } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";
import { WorkboardDal } from "../workboard/dal.js";
import { resolveWorkspaceId } from "../workspace/id.js";
import {
  buildChannelSourceKey,
  DEFAULT_CHANNEL_ACCOUNT_ID,
  parseChannelSourceKey,
} from "./interface.js";

export type ChannelInboxStatus = "queued" | "processing" | "completed" | "failed";

const DEFAULT_INBOUND_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INBOUND_DEDUPE_TTL_ENV = "TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS";
const DEFAULT_INBOUND_QUEUE_CAP = 100;
const INBOUND_QUEUE_CAP_ENV = "TYRUM_CHANNEL_INBOUND_QUEUE_CAP";
const DEFAULT_INBOUND_QUEUE_OVERFLOW = "drop_oldest";
const INBOUND_QUEUE_OVERFLOW_ENV = "TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW";
const DEFAULT_QUEUE_MODE = "collect";
const ALLOWED_QUEUE_MODES = new Set(["collect", "followup", "steer", "steer_backlog", "interrupt"]);
const ALLOWED_OVERFLOW_POLICIES = new Set(["drop_oldest", "drop_newest", "summarize_dropped"]);

export type ChannelInboundQueueOverflowPolicy = "drop_oldest" | "drop_newest" | "summarize_dropped";

export type ChannelInboundQueueOverflowResult = {
  cap: number;
  policy: ChannelInboundQueueOverflowPolicy;
  queued_before: number;
  queued_after: number;
  dropped: Array<{
    inbox_id: number;
    thread_id: string;
    message_id: string;
    received_at_ms: number;
  }>;
  summary?: { inbox_id: number; message_id: string };
};

function normalizeQueueMode(raw: string | undefined): string {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return ALLOWED_QUEUE_MODES.has(normalized) ? normalized : DEFAULT_QUEUE_MODE;
}

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

function inboundQueueCap(): number | undefined {
  const raw = process.env[INBOUND_QUEUE_CAP_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const cap = Math.floor(parsed);
      if (cap <= 0) return undefined;
      return cap;
    }
  }
  return DEFAULT_INBOUND_QUEUE_CAP;
}

function inboundQueueOverflowPolicy(): ChannelInboundQueueOverflowPolicy {
  const raw = process.env[INBOUND_QUEUE_OVERFLOW_ENV]?.trim();
  if (raw) {
    const normalized = raw.trim().toLowerCase();
    if (ALLOWED_OVERFLOW_POLICIES.has(normalized)) {
      return normalized as ChannelInboundQueueOverflowPolicy;
    }
  }
  return DEFAULT_INBOUND_QUEUE_OVERFLOW;
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

function extractTextFromNormalizedMessage(normalized: NormalizedThreadMessage): {
  text: string;
  attachments: number;
} {
  const envelope = normalized.message.envelope;
  if (envelope) {
    return {
      text: envelope.content.text?.trim() ?? "",
      attachments: envelope.content.attachments.length,
    };
  }

  const content = normalized.message.content;
  if (content.kind === "text") {
    return { text: content.text.trim(), attachments: 0 };
  }
  return { text: (content.caption ?? "").trim(), attachments: 1 };
}

function summarizeText(value: string): string {
  const trimmed = value.trim().replaceAll(/\s+/g, " ");
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 197)}…`;
}

function buildQueueOverflowSummaryText(input: {
  cap: number;
  dropped: Array<{ messageText: string; attachments: number }>;
}): string {
  const droppedCount = input.dropped.length;
  const lines: string[] = [];
  lines.push(
    `Queue overflow: dropped ${String(droppedCount)} message(s) (cap=${String(input.cap)}).`,
  );
  lines.push("");
  lines.push("Dropped messages (oldest first):");

  const maxItems = 5;
  for (let i = 0; i < Math.min(maxItems, droppedCount); i += 1) {
    const item = input.dropped[i]!;
    const parts: string[] = [];
    if (item.messageText.length > 0) {
      parts.push(summarizeText(item.messageText));
    }
    if (item.attachments > 0) {
      parts.push(`attachments=${String(item.attachments)}`);
    }
    const rendered = parts.length > 0 ? parts.join(" ") : "(no text)";
    lines.push(`- ${rendered}`);
  }
  if (droppedCount > maxItems) {
    lines.push(`- … (+${String(droppedCount - maxItems)} more)`);
  }

  return lines.join("\n");
}

type RawQueuedInboxRow = {
  inbox_id: number;
  source: string;
  thread_id: string;
  message_id: string;
  received_at_ms: number;
  payload_json: string;
};

async function completeInboxRows(tx: SqlDb, inboxIds: number[], nowIso: string): Promise<number[]> {
  const completed: number[] = [];
  for (const inboxId of inboxIds) {
    const updated = await tx.run(
      `UPDATE channel_inbox
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = COALESCE(processed_at, ?),
           error = NULL,
           reply_text = COALESCE(reply_text, '')
       WHERE inbox_id = ? AND status = 'queued'`,
      [nowIso, inboxId],
    );
    if (updated.changes === 1) {
      completed.push(inboxId);
    }
  }
  return completed;
}

async function countQueued(tx: SqlDb, input: { key: string; lane: string }): Promise<number> {
  const row = await tx.get<{ queued: number | string }>(
    `SELECT COUNT(1) AS queued
     FROM channel_inbox
     WHERE status = 'queued' AND key = ? AND lane = ?`,
    [input.key, input.lane],
  );
  const queued = row?.queued;
  if (typeof queued === "number") return queued;
  const parsed = Number(queued);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function insertSyntheticInboxRow(
  tx: SqlDb,
  input: {
    source: string;
    thread_id: string;
    message_id: string;
    key: string;
    lane: string;
    queue_mode: string;
    received_at_ms: number;
    payload_json: string;
  },
): Promise<number> {
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
        input.source,
        input.thread_id,
        input.message_id,
        input.key,
        input.lane,
        input.queue_mode,
        input.received_at_ms,
        input.payload_json,
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
        input.source,
        input.thread_id,
        input.message_id,
        input.key,
        input.lane,
        input.queue_mode,
        input.received_at_ms,
        input.payload_json,
      ],
    );
    const inserted = await tx.get<{ inbox_id: number }>("SELECT last_insert_rowid() AS inbox_id");
    inboxId = inserted?.inbox_id;
  }

  if (typeof inboxId !== "number" || !Number.isFinite(inboxId)) {
    throw new Error("failed to enqueue queue overflow summary");
  }

  return inboxId;
}

async function applyInboundQueueOverflowPolicy(
  tx: SqlDb,
  input: {
    key: string;
    lane: string;
    cap: number;
    policy: ChannelInboundQueueOverflowPolicy;
  },
): Promise<ChannelInboundQueueOverflowResult | undefined> {
  const queuedBefore = await countQueued(tx, { key: input.key, lane: input.lane });
  if (queuedBefore <= input.cap) return undefined;

  const nowIso = new Date().toISOString();
  const dropped: ChannelInboundQueueOverflowResult["dropped"] = [];
  let summary: ChannelInboundQueueOverflowResult["summary"] | undefined;

  let queued = queuedBefore;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts && queued > input.cap; attempt += 1) {
    const overflow = Math.max(0, queued - input.cap);
    if (overflow === 0) break;

    const effectivePolicy: ChannelInboundQueueOverflowPolicy =
      input.policy === "summarize_dropped" && summary ? "drop_oldest" : input.policy;

    if (effectivePolicy === "drop_oldest" || effectivePolicy === "drop_newest") {
      const ordering = effectivePolicy === "drop_oldest" ? "ASC" : "DESC";
      const rows = await tx.all<
        Pick<RawQueuedInboxRow, "inbox_id" | "thread_id" | "message_id" | "received_at_ms">
      >(
        `SELECT inbox_id, thread_id, message_id, received_at_ms
         FROM channel_inbox
         WHERE status = 'queued' AND key = ? AND lane = ?
         ORDER BY received_at_ms ${ordering}, inbox_id ${ordering}
         LIMIT ?`,
        [input.key, input.lane, overflow],
      );
      if (rows.length === 0) break;

      const completedIds = await completeInboxRows(
        tx,
        rows.map((r) => r.inbox_id),
        nowIso,
      );
      const completedSet = new Set(completedIds);
      for (const row of rows) {
        if (!completedSet.has(row.inbox_id)) continue;
        dropped.push({
          inbox_id: row.inbox_id,
          thread_id: row.thread_id,
          message_id: row.message_id,
          received_at_ms: row.received_at_ms,
        });
      }

      queued = await countQueued(tx, { key: input.key, lane: input.lane });
      continue;
    }

    // summarize_dropped (insert only one synthetic summary row per enforcement call)
    const dropCount = overflow + 1;
    const rows = await tx.all<RawQueuedInboxRow>(
      `SELECT inbox_id, source, thread_id, message_id, received_at_ms, payload_json
       FROM channel_inbox
       WHERE status = 'queued' AND key = ? AND lane = ?
       ORDER BY received_at_ms ASC, inbox_id ASC
       LIMIT ?`,
      [input.key, input.lane, dropCount],
    );
    if (rows.length === 0) break;

    const completedIds = await completeInboxRows(
      tx,
      rows.map((r) => r.inbox_id),
      nowIso,
    );
    const completedSet = new Set(completedIds);
    const completedRows = rows.filter((r) => completedSet.has(r.inbox_id));

    for (const row of completedRows) {
      dropped.push({
        inbox_id: row.inbox_id,
        thread_id: row.thread_id,
        message_id: row.message_id,
        received_at_ms: row.received_at_ms,
      });
    }

    if (completedRows.length > 0 && !summary) {
      const droppedDescriptions: Array<{ messageText: string; attachments: number }> = [];
      for (const row of completedRows) {
        const parsed = NormalizedThreadMessageSchema.safeParse(safeJsonParse(row.payload_json, {}));
        if (parsed.success) {
          const extracted = extractTextFromNormalizedMessage(parsed.data);
          droppedDescriptions.push({
            messageText: extracted.text,
            attachments: extracted.attachments,
          });
        } else {
          droppedDescriptions.push({ messageText: "", attachments: 0 });
        }
      }

      const summaryText = buildQueueOverflowSummaryText({
        cap: input.cap,
        dropped: droppedDescriptions,
      });
      const syntheticMessageId = `queue_overflow:${randomUUID()}`;
      const basePayload = safeJsonParse(completedRows[0]!.payload_json, {});
      const parsedBase = NormalizedThreadMessageSchema.safeParse(basePayload);
      const summarySource = completedRows[0]?.source ?? "telegram";
      const summaryAddress = (() => {
        try {
          return parseChannelSourceKey(summarySource);
        } catch (err) {
          // Intentional: fall back to a default connector when the persisted source key is invalid.
          void err;
          return { connector: "telegram", accountId: DEFAULT_CHANNEL_ACCOUNT_ID };
        }
      })();
      const fallbackThreadId = completedRows[0]?.thread_id ?? input.key;
      const thread = parsedBase.success
        ? parsedBase.data.thread
        : {
            id: fallbackThreadId,
            kind: "other" as const,
            title: undefined,
            username: undefined,
            pii_fields: [],
          };
      const containerKind = normalizedContainerKindFromThreadKind(thread.kind);
      const createdIso = new Date().toISOString();
      const syntheticPayload: NormalizedThreadMessage = {
        thread,
        message: {
          id: syntheticMessageId,
          thread_id: thread.id,
          source: parsedBase.success ? parsedBase.data.message.source : "telegram",
          content: { kind: "text", text: summaryText },
          sender: {
            id: "system",
            is_bot: true,
            username: "tyrum",
          },
          timestamp: createdIso,
          edited_timestamp: undefined,
          pii_fields: ["message_text"],
          envelope: {
            message_id: syntheticMessageId,
            received_at: createdIso,
            delivery: { channel: summaryAddress.connector, account: summaryAddress.accountId },
            container: { kind: containerKind, id: thread.id },
            sender: { id: "system", display: "Tyrum" },
            content: { text: summaryText, attachments: [] },
            provenance: ["system"],
          },
        },
      };

      const summaryReceivedAtMs = completedRows[completedRows.length - 1]!.received_at_ms;
      const summaryInboxId = await insertSyntheticInboxRow(tx, {
        source: completedRows[0]?.source ?? "telegram",
        thread_id: completedRows[0]?.thread_id ?? fallbackThreadId,
        message_id: syntheticMessageId,
        key: input.key,
        lane: input.lane,
        queue_mode: "followup",
        received_at_ms: summaryReceivedAtMs,
        payload_json: JSON.stringify(syntheticPayload),
      });

      summary = { inbox_id: summaryInboxId, message_id: syntheticMessageId };
    }

    queued = await countQueued(tx, { key: input.key, lane: input.lane });
  }

  const queuedAfter = queued;
  return {
    cap: input.cap,
    policy: input.policy,
    queued_before: queuedBefore,
    queued_after: queuedAfter,
    dropped,
    ...(summary ? { summary } : {}),
  };
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
  }): Promise<{
    row: ChannelInboxRow;
    deduped: boolean;
    overflow?: ChannelInboundQueueOverflowResult;
  }> {
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
    const queueMode = normalizeQueueMode(input.queue_mode);
    const cap = inboundQueueCap();
    const overflowPolicy = inboundQueueOverflowPolicy();

    const result = await this.db.transaction(async (tx) => {
      // Best-effort prune of expired keys to keep the dedupe table bounded.
      await tx.run("DELETE FROM channel_inbound_dedupe WHERE expires_at_ms <= ?", [receivedAtMs]);

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

      const overflow = cap
        ? await applyInboundQueueOverflowPolicy(tx, {
            key: input.key,
            lane: input.lane,
            cap,
            policy: overflowPolicy,
          })
        : undefined;

      const finalRow = await tx.get<RawChannelInboxRow>(
        "SELECT * FROM channel_inbox WHERE inbox_id = ?",
        [inboxId],
      );
      if (!finalRow) {
        throw new Error("failed to enqueue inbound message");
      }

      return { row: toRow(finalRow), deduped: false, overflow };
    });

    // Best-effort update of durable last-active routing for completion notifications.
    try {
      const parsed = parseTyrumKey(input.key as never);
      if (parsed.kind === "agent") {
        await new WorkboardDal(this.db).upsertScopeActivity({
          scope: {
            tenant_id: "default",
            agent_id: parsed.agent_id,
            workspace_id: resolveWorkspaceId(),
          },
          last_active_session_key: input.key,
          updated_at_ms: receivedAtMs,
        });
      }
    } catch (err) {
      // Intentional: completion notifications are best-effort; ignore invalid keys or activity update failures.
      void err;
    }

    return result;
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
    queue_mode?: string;
  }): Promise<ChannelInboxRow[]> {
    if (input.limit <= 0) return [];
    const queueMode = input.queue_mode?.trim();
    const queueModeClause = queueMode ? " AND queue_mode = ?" : "";
    const queueModeArgs = queueMode ? [queueMode] : [];
    const rows = await this.db.all<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE status = 'queued'
         AND key = ?
         AND lane = ?
         AND received_at_ms >= ?
         AND received_at_ms <= ?
         ${queueModeClause}
       ORDER BY received_at_ms ASC, inbox_id ASC
       LIMIT ?`,
      [
        input.key,
        input.lane,
        input.received_at_ms_gte,
        input.received_at_ms_lte,
        ...queueModeArgs,
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
