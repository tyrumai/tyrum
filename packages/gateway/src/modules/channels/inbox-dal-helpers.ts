import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  normalizedContainerKindFromThreadKind,
} from "@tyrum/schemas";
import type { NormalizedThreadMessage } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";
import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  parseChannelSourceKey,
} from "./interface.js";
import type {
  ChannelInboundQueueOverflowPolicy,
  ChannelInboundQueueOverflowResult,
  ChannelInboxRow,
  ChannelInboxStatus,
  RawChannelInboxRow,
  RawQueuedInboxRow,
} from "./inbox-dal-types.js";

const ALLOWED_QUEUE_MODES = new Set(["collect", "followup", "steer", "steer_backlog", "interrupt"]);
const DEFAULT_QUEUE_MODE = "collect";

export function normalizeQueueMode(raw: string | undefined): string {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return ALLOWED_QUEUE_MODES.has(normalized) ? normalized : DEFAULT_QUEUE_MODE;
}

export function normalizeTime(value: string | Date | null): string | null {
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

async function dropQueuedInboxRows(tx: SqlDb, inboxIds: number[]): Promise<number[]> {
  const dropped: number[] = [];
  for (const inboxId of inboxIds) {
    const deleted = await tx.run(
      "DELETE FROM channel_inbox WHERE inbox_id = ? AND status = 'queued'",
      [inboxId],
    );
    if (deleted.changes === 1) {
      dropped.push(inboxId);
    }
  }
  return dropped;
}

async function countQueued(
  tx: SqlDb,
  input: { tenantId: string; key: string; lane: string },
): Promise<number> {
  const row = await tx.get<{ queued: number | string }>(
    `SELECT COUNT(1) AS queued
     FROM channel_inbox
     WHERE tenant_id = ?
       AND status = 'queued'
       AND key = ?
       AND lane = ?`,
    [input.tenantId, input.key, input.lane],
  );
  const queued = row?.queued;
  if (typeof queued === "number") return queued;
  const parsed = Number(queued);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function insertSyntheticInboxRow(
  tx: SqlDb,
  input: {
    tenant_id: string;
    source: string;
    thread_id: string;
    message_id: string;
    key: string;
    lane: string;
    queue_mode: string;
    received_at_ms: number;
    payload_json: string;
    workspace_id: string;
    session_id: string;
    channel_thread_id: string;
  },
): Promise<number> {
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
        input.tenant_id,
        input.source,
        input.thread_id,
        input.message_id,
        input.key,
        input.lane,
        input.queue_mode,
        input.received_at_ms,
        input.payload_json,
        input.workspace_id,
        input.session_id,
        input.channel_thread_id,
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
        input.tenant_id,
        input.source,
        input.thread_id,
        input.message_id,
        input.key,
        input.lane,
        input.queue_mode,
        input.received_at_ms,
        input.payload_json,
        input.workspace_id,
        input.session_id,
        input.channel_thread_id,
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

export async function applyInboundQueueOverflowPolicy(
  tx: SqlDb,
  input: {
    tenantId: string;
    workspaceId: string;
    sessionId: string;
    channelThreadId: string;
    key: string;
    lane: string;
    cap: number;
    policy: ChannelInboundQueueOverflowPolicy;
  },
): Promise<ChannelInboundQueueOverflowResult | undefined> {
  const queuedBefore = await countQueued(tx, {
    tenantId: input.tenantId,
    key: input.key,
    lane: input.lane,
  });
  if (queuedBefore <= input.cap) return undefined;

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
         WHERE tenant_id = ?
           AND status = 'queued'
           AND key = ?
           AND lane = ?
         ORDER BY received_at_ms ${ordering}, inbox_id ${ordering}
         LIMIT ?`,
        [input.tenantId, input.key, input.lane, overflow],
      );
      if (rows.length === 0) break;

      const droppedIds = await dropQueuedInboxRows(
        tx,
        rows.map((r) => r.inbox_id),
      );
      const droppedSet = new Set(droppedIds);
      for (const row of rows) {
        if (!droppedSet.has(row.inbox_id)) continue;
        dropped.push({
          inbox_id: row.inbox_id,
          thread_id: row.thread_id,
          message_id: row.message_id,
          received_at_ms: row.received_at_ms,
        });
      }

      queued = await countQueued(tx, {
        tenantId: input.tenantId,
        key: input.key,
        lane: input.lane,
      });
      continue;
    }

    // summarize_dropped (insert only one synthetic summary row per enforcement call)
    const dropCount = overflow + 1;
    const rows = await tx.all<RawQueuedInboxRow>(
      `SELECT inbox_id, source, thread_id, message_id, received_at_ms, payload_json
       FROM channel_inbox
       WHERE tenant_id = ?
         AND status = 'queued'
         AND key = ?
         AND lane = ?
       ORDER BY received_at_ms ASC, inbox_id ASC
      LIMIT ?`,
      [input.tenantId, input.key, input.lane, dropCount],
    );
    if (rows.length === 0) break;

    const droppedIds = await dropQueuedInboxRows(
      tx,
      rows.map((r) => r.inbox_id),
    );
    const droppedSet = new Set(droppedIds);
    const droppedRows = rows.filter((r) => droppedSet.has(r.inbox_id));

    for (const row of droppedRows) {
      dropped.push({
        inbox_id: row.inbox_id,
        thread_id: row.thread_id,
        message_id: row.message_id,
        received_at_ms: row.received_at_ms,
      });
    }

    if (droppedRows.length > 0 && !summary) {
      const droppedDescriptions: Array<{ messageText: string; attachments: number }> = [];
      for (const row of droppedRows) {
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
      const basePayload = safeJsonParse(droppedRows[0]!.payload_json, {});
      const parsedBase = NormalizedThreadMessageSchema.safeParse(basePayload);
      const summarySource = droppedRows[0]?.source ?? "telegram";
      const summaryAddress = (() => {
        try {
          return parseChannelSourceKey(summarySource);
        } catch (err) {
          // Intentional: fall back to a default connector when the persisted source key is invalid.
          void err;
          return { connector: "telegram", accountId: DEFAULT_CHANNEL_ACCOUNT_ID };
        }
      })();
      const fallbackThreadId = droppedRows[0]?.thread_id ?? input.key;
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

      const summaryReceivedAtMs = droppedRows[droppedRows.length - 1]!.received_at_ms;
      const summaryInboxId = await insertSyntheticInboxRow(tx, {
        tenant_id: input.tenantId,
        source: droppedRows[0]?.source ?? "telegram",
        thread_id: droppedRows[0]?.thread_id ?? fallbackThreadId,
        message_id: syntheticMessageId,
        key: input.key,
        lane: input.lane,
        queue_mode: "followup",
        received_at_ms: summaryReceivedAtMs,
        payload_json: JSON.stringify(syntheticPayload),
        workspace_id: input.workspaceId,
        session_id: input.sessionId,
        channel_thread_id: input.channelThreadId,
      });

      summary = { inbox_id: summaryInboxId, message_id: syntheticMessageId };
    }

    queued = await countQueued(tx, { tenantId: input.tenantId, key: input.key, lane: input.lane });
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

export function toRow(raw: RawChannelInboxRow): ChannelInboxRow {
  return {
    inbox_id: raw.inbox_id,
    tenant_id: raw.tenant_id,
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
    workspace_id: raw.workspace_id,
    session_id: raw.session_id,
    channel_thread_id: raw.channel_thread_id,
  };
}
