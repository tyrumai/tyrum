import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { MemoryDal } from "../memory/dal.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import {
  base32Encode,
  ProvenanceTag as ProvenanceTagSchema,
  QueueMode as QueueModeSchema,
  type ProvenanceTag,
  type QueueMode,
} from "@tyrum/schemas";
import { PolicyBundleService } from "../policy-bundle/service.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import { ChannelInboxDal, type QueueOverflowPolicy } from "./inbox-dal.js";
import { ChannelOutboxDal, type OutboundSendRow } from "./outbox-dal.js";
import { formatAgentSessionKey, type DmScope, type ContainerKind } from "./session-key.js";
import { chunkMarkdownIr, parseMarkdownToIr, renderTelegramHtml } from "../formatting/markdown-ir.js";

interface RawInboundRow {
  channel: string;
  account_id: string;
  container_id: string;
  message_id: string;
  thread_kind: string;
  sender_id: string | null;
  sender_is_bot: number | boolean;
  provenance_json: unknown;
  text: string | null;
  has_attachment: number | boolean;
  received_at_ms: number;
  status: string;
}

function parseProvenance(value: unknown): ProvenanceTag[] {
  try {
    const raw =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!Array.isArray(raw)) return [];
    const out: ProvenanceTag[] = [];
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const parsed = ProvenanceTagSchema.safeParse(entry);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

function mapThreadKind(kind: string): ContainerKind {
  switch (kind) {
    case "private":
      return "dm";
    case "group":
    case "supergroup":
      return "group";
    case "channel":
      return "channel";
    default:
      return "group";
  }
}

function normalizeDmScope(raw: string | undefined): DmScope | undefined {
  const value = raw?.trim().toLowerCase();
  switch (value) {
    case "shared":
    case "per_peer":
    case "per_channel_peer":
    case "per_account_channel_peer":
      return value;
    default:
      return undefined;
  }
}

function normalizeQueueMode(raw: string | undefined): QueueMode | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  const parsed = QueueModeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeOverflowPolicy(raw: string | undefined): QueueOverflowPolicy | undefined {
  const value = raw?.trim().toLowerCase();
  switch (value) {
    case "drop_oldest":
    case "drop_newest":
    case "summarize_dropped":
      return value;
    default:
      return undefined;
  }
}

function normalizeQueueCap(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(500, n));
}

function normalizeSummaryMaxChars(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(200, Math.min(20_000, n));
}

function deriveIdempotencyKey(parts: readonly string[]): string {
  const h = createHash("sha256").update(parts.join("|"), "utf8").digest();
  return base32Encode(h).slice(0, 26);
}

function chunkPlainText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, maxChars);
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n");
    if (cut < Math.floor(limit * 0.6)) {
      cut = window.lastIndexOf(" ");
    }
    if (cut < 1) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks.length > 0 ? chunks : [""];
}

export interface ChannelWorkerOptions {
  db: SqlDb;
  memoryDal: MemoryDal;
  agentRuntime?: AgentRuntime;
  telegramBot?: TelegramBot;
  approvalDal: ApprovalDal;
  approvalNotifier?: ApprovalNotifier;
  logger?: Logger;

  /** Lease owner id for HA coordination. Defaults to a random id. */
  leaseOwner?: string;
  /** Lease name used in scheduler_leases. Defaults to "channel-worker". */
  leaseName?: string;
  /** Lease TTL in milliseconds. Defaults to 5000. */
  leaseTtlMs?: number;

  /** Debounce window for text-only messages. Defaults to 1000ms. */
  debounceMs?: number;
  /** Max message chunks for outbound delivery. Defaults to Telegram 4096 safe split at 3800. */
  telegramMaxChars?: number;
  /** Poll interval for background worker. Defaults to 250ms. */
  tickMs?: number;
  /** When true, the interval keeps the Node.js process alive. Defaults to false. */
  keepProcessAlive?: boolean;

  /** Queue mode applied when multiple inbound messages are pending for a container. Defaults to "collect". */
  queueMode?: QueueMode;
  /** Max pending inbound messages per container (cap). Defaults to 50. */
  queueCap?: number;
  /** Overflow policy when cap is exceeded. Defaults to "drop_oldest". */
  queueOverflow?: QueueOverflowPolicy;
  /** Max chars for synthesized overflow summaries. Defaults to 2400. */
  queueSummaryMaxChars?: number;
}

export class ChannelWorker {
  private readonly db: SqlDb;
  private readonly memoryDal: MemoryDal;
  private readonly agentRuntime?: AgentRuntime;
  private readonly telegramBot?: TelegramBot;
  private readonly approvalDal: ApprovalDal;
  private readonly approvalNotifier?: ApprovalNotifier;
  private readonly logger?: Logger;
  private readonly leaseOwner: string;
  private readonly leaseName: string;
  private readonly leaseTtlMs: number;
  private readonly debounceMs: number;
  private readonly telegramMaxChars: number;
  private readonly tickMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly agentId: string;
  private readonly queueMode: QueueMode;
  private readonly queueCap: number;
  private readonly queueOverflow: QueueOverflowPolicy;
  private readonly queueSummaryMaxChars: number;

  private readonly inboxDal: ChannelInboxDal;
  private readonly outboxDal: ChannelOutboxDal;
  private readonly policyBundleService: PolicyBundleService;

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: ChannelWorkerOptions) {
    this.db = opts.db;
    this.memoryDal = opts.memoryDal;
    this.agentRuntime = opts.agentRuntime;
    this.telegramBot = opts.telegramBot;
    this.approvalDal = opts.approvalDal;
    this.approvalNotifier = opts.approvalNotifier;
    this.logger = opts.logger;
    this.leaseOwner = opts.leaseOwner ?? `chan-${randomUUID()}`;
    this.leaseName = opts.leaseName ?? "channel-worker";
    this.leaseTtlMs = Math.max(1_000, opts.leaseTtlMs ?? 5_000);
    this.debounceMs = Math.max(0, Math.floor(opts.debounceMs ?? 1_000));
    this.telegramMaxChars = Math.max(500, Math.floor(opts.telegramMaxChars ?? 3_800));
    this.tickMs = Math.max(50, Math.floor(opts.tickMs ?? 250));
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.agentId = process.env["TYRUM_AGENT_ID"]?.trim() || "default";
    this.queueMode =
      opts.queueMode ??
      normalizeQueueMode(process.env["TYRUM_CHANNEL_QUEUE_MODE"]) ??
      normalizeQueueMode(process.env["TYRUM_QUEUE_MODE"]) ??
      "collect";
    this.queueCap =
      opts.queueCap ??
      normalizeQueueCap(process.env["TYRUM_CHANNEL_QUEUE_CAP"]) ??
      normalizeQueueCap(process.env["TYRUM_QUEUE_CAP"]) ??
      50;
    this.queueOverflow =
      opts.queueOverflow ??
      normalizeOverflowPolicy(process.env["TYRUM_CHANNEL_QUEUE_OVERFLOW"]) ??
      normalizeOverflowPolicy(process.env["TYRUM_QUEUE_OVERFLOW"]) ??
      "drop_oldest";
    this.queueSummaryMaxChars =
      opts.queueSummaryMaxChars ??
      normalizeSummaryMaxChars(process.env["TYRUM_CHANNEL_QUEUE_SUMMARY_MAX_CHARS"]) ??
      normalizeSummaryMaxChars(process.env["TYRUM_QUEUE_SUMMARY_MAX_CHARS"]) ??
      2400;

    this.inboxDal = new ChannelInboxDal(opts.db);
    this.outboxDal = new ChannelOutboxDal(opts.db);
    this.policyBundleService = new PolicyBundleService(opts.db, { logger: opts.logger });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    if (!this.keepProcessAlive) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing -- runs one processing cycle. */
  async tick(): Promise<void> {
    const nowMs = Date.now();

    const leaseOk = await this.tryAcquireLease(nowMs);
    if (!leaseOk) return;

    await this.processInbound(nowMs);
    await this.processOutbound(nowMs);
  }

  async enqueueTelegramInbound(opts: {
    accountId: string;
    containerId: string;
    messageId: string;
    threadKind: string;
    senderId?: string;
    senderIsBot: boolean;
    provenance: readonly ProvenanceTag[];
    text?: string;
    hasAttachment: boolean;
    receivedAtMs: number;
  }): Promise<{
    kind: "deduped" | "queued" | "dropped";
    dropped?: number;
    overflowPolicy?: QueueOverflowPolicy;
    summarized?: boolean;
  }> {
    const result = await this.inboxDal.enqueueMessage(
      {
        channel: "telegram",
        accountId: opts.accountId,
        containerId: opts.containerId,
        messageId: opts.messageId,
        threadKind: opts.threadKind,
        senderId: opts.senderId,
        senderIsBot: opts.senderIsBot,
        provenance: opts.provenance,
        text: opts.text,
        hasAttachment: opts.hasAttachment,
        receivedAtMs: opts.receivedAtMs,
      },
      {
        cap: this.queueCap,
        overflow: this.queueOverflow,
        summarizeMaxChars: this.queueSummaryMaxChars,
      },
    );

    const occurredAt = new Date().toISOString();
    if (result.kind === "deduped") {
      await this.memoryDal.insertEpisodicEvent(
        this.agentId,
        `channel-inbound-deduped-${randomUUID()}`,
        occurredAt,
        "telegram",
        "channel_inbound_deduped",
        {
          channel: "telegram",
          account_id: opts.accountId,
          container_id: opts.containerId,
          message_id: opts.messageId,
        },
      );
      return { kind: "deduped" };
    }

    if (result.dropped > 0) {
      await this.memoryDal.insertEpisodicEvent(
        this.agentId,
        `channel-inbound-overflow-${randomUUID()}`,
        occurredAt,
        "telegram",
        "channel_inbound_overflow",
        {
          channel: "telegram",
          account_id: opts.accountId,
          container_id: opts.containerId,
          dropped: result.dropped,
          overflow_policy: result.overflowPolicy,
          summarized: result.summarized,
        },
      );
    }

    return {
      kind: result.kind,
      dropped: result.dropped,
      overflowPolicy: result.overflowPolicy,
      summarized: result.summarized,
    };
  }

  private async tryAcquireLease(nowMs: number): Promise<boolean> {
    const expiresAtMs = nowMs + this.leaseTtlMs;
    const result = await this.db.run(
      `INSERT INTO scheduler_leases (lease_name, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (lease_name) DO UPDATE SET
         lease_owner = excluded.lease_owner,
         lease_expires_at_ms = excluded.lease_expires_at_ms
       WHERE scheduler_leases.lease_expires_at_ms <= ? OR scheduler_leases.lease_owner = ?`,
      [this.leaseName, this.leaseOwner, expiresAtMs, nowMs, this.leaseOwner],
    );
    return result.changes === 1;
  }

  private async processInbound(nowMs: number): Promise<void> {
    if (!this.agentRuntime) return;

    const cutoffMs = nowMs - this.debounceMs;

    const ready = await this.db.all<{
      channel: string;
      account_id: string;
      container_id: string;
    }>(
      `SELECT channel, account_id, container_id
       FROM channel_inbound_messages
       WHERE status = 'pending'
       GROUP BY channel, account_id, container_id
       HAVING MAX(CASE WHEN has_attachment THEN 1 ELSE 0 END) = 1
          OR MAX(received_at_ms) <= ?
       ORDER BY MIN(received_at_ms) ASC
       LIMIT 10`,
      [cutoffMs],
    );

    for (const c of ready) {
      await this.processContainer(c.channel, c.account_id, c.container_id, nowMs);
    }
  }

  private async claimPendingMessages(
    channel: string,
    accountId: string,
    containerId: string,
    nowMs: number,
  ): Promise<RawInboundRow[]> {
    const nowIso = new Date().toISOString();
    const leaseExpiresAt = nowMs + 60_000;

    return await this.db.transaction(async (tx) => {
      const rows = await tx.all<{ message_id: string }>(
        `SELECT message_id
         FROM channel_inbound_messages
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'
         ORDER BY received_at_ms ASC
         LIMIT ?`,
        [channel, accountId, containerId, this.queueCap],
      );
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.message_id);
      const placeholders = ids.map(() => "?").join(", ");

      const updated = await tx.run(
        `UPDATE channel_inbound_messages
         SET status = 'processing',
             processing_owner = ?,
             processing_expires_at_ms = ?,
             updated_at = ?
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'pending'
           AND message_id IN (${placeholders})`,
        [
          this.leaseOwner,
          leaseExpiresAt,
          nowIso,
          channel,
          accountId,
          containerId,
          ...ids,
        ],
      );

      if (updated.changes === 0) return [];

      const claimed = await tx.all<RawInboundRow>(
        `SELECT channel, account_id, container_id, message_id, thread_kind, sender_id, sender_is_bot,
                provenance_json, text, has_attachment, received_at_ms, status
         FROM channel_inbound_messages
         WHERE channel = ? AND account_id = ? AND container_id = ?
           AND status = 'processing' AND processing_owner = ?
         ORDER BY received_at_ms ASC`,
        [channel, accountId, containerId, this.leaseOwner],
      );
      return claimed;
    });
  }

  private async markClaimedMessages(opts: {
    channel: string;
    accountId: string;
    containerId: string;
    messageIds: readonly string[];
    status: "completed" | "failed" | "dropped";
    nowMs: number;
    error: string | null;
  }): Promise<void> {
    if (opts.messageIds.length === 0) return;
    const nowIso = new Date().toISOString();
    const placeholders = opts.messageIds.map(() => "?").join(", ");
    await this.db.run(
      `UPDATE channel_inbound_messages
       SET status = ?, processed_at_ms = ?, updated_at = ?, error = ?,
           processing_owner = NULL, processing_expires_at_ms = NULL
       WHERE channel = ? AND account_id = ? AND container_id = ?
         AND status = 'processing' AND processing_owner = ?
         AND message_id IN (${placeholders})`,
      [
        opts.status,
        opts.nowMs,
        nowIso,
        opts.error,
        opts.channel,
        opts.accountId,
        opts.containerId,
        this.leaseOwner,
        ...opts.messageIds,
      ],
    );
  }

  private async processContainer(
    channel: string,
    accountId: string,
    containerId: string,
    nowMs: number,
  ): Promise<void> {
    const claimed = await this.claimPendingMessages(channel, accountId, containerId, nowMs);
    if (claimed.length === 0) return;

    const occurredAt = new Date().toISOString();
    const first = claimed[0]!;
    const newest = claimed[claimed.length - 1]!;

    const mode = this.queueMode;
    const dropIds: string[] = [];
    const groups: RawInboundRow[][] = [];

    switch (mode) {
      case "collect":
        groups.push(claimed);
        break;
      case "followup":
        for (const msg of claimed) groups.push([msg]);
        break;
      case "interrupt":
      case "steer": {
        groups.push([newest]);
        dropIds.push(...claimed.slice(0, -1).map((m) => m.message_id));
        break;
      }
      case "steer_backlog": {
        groups.push([newest]);
        const rest = claimed.slice(0, -1);
        if (rest.length > 0) groups.push(rest);
        break;
      }
      default:
        groups.push(claimed);
        break;
    }

    if (dropIds.length > 0) {
      await this.markClaimedMessages({
        channel,
        accountId,
        containerId,
        messageIds: dropIds,
        status: "dropped",
        nowMs,
        error: `queue mode ${mode}`,
      });

      await this.memoryDal.insertEpisodicEvent(
        this.agentId,
        `channel-inbound-queue-drop-${randomUUID()}`,
        occurredAt,
        channel,
        "channel_inbound_queue_drop",
        {
          channel,
          account_id: accountId,
          container_id: containerId,
          queue_mode: mode,
          dropped: dropIds.length,
        },
      );
    }

    const containerKind = mapThreadKind(first.thread_kind);

    const agentId = this.agentId;
    const dmScope =
      normalizeDmScope(process.env["TELEGRAM_DM_SCOPE"]) ??
      normalizeDmScope(process.env["TYRUM_DM_SCOPE"]) ??
      "per_account_channel_peer";

    const peerId = first.sender_id ?? undefined;
    const sessionKey = formatAgentSessionKey({
      agentId,
      channel,
      accountId,
      containerKind,
      containerId,
      peerId,
      dmScope,
    });

    for (const group of groups) {
      const messageIds = group.map((m) => m.message_id);
      const combined = group
        .map((m) => m.text ?? "")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .join("\n");

      if (!combined) {
        await this.markClaimedMessages({
          channel,
          accountId,
          containerId,
          messageIds,
          status: "completed",
          nowMs,
          error: "empty message",
        });
        continue;
      }

      let reply: string;
      let runtimeSessionId: string | undefined;

      const inboundProvenanceSources = Array.from(
        new Set(group.flatMap((m) => parseProvenance(m.provenance_json))),
      );
      let derivedProvenanceSources = inboundProvenanceSources;

      try {
        const res = await this.agentRuntime!.turn({
          channel,
          thread_id: sessionKey,
          message: combined,
          metadata: {
            provenance_sources: inboundProvenanceSources,
          },
        });
        reply = res.reply;
        runtimeSessionId = res.session_id;
        if (res.provenance_sources && res.provenance_sources.length > 0) {
          derivedProvenanceSources = res.provenance_sources;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("channel.inbound.agent_failed", {
          channel,
          account_id: accountId,
          container_id: containerId,
          error: message,
        });
        reply = "Sorry, something went wrong. Please try again later.";
      }

      const batchKey = deriveIdempotencyKey([channel, accountId, containerId, ...messageIds]);
      const idempotencyKey = `reply:${channel}:${accountId}:${containerId}:${batchKey}`;

      const policy = await this.policyBundleService.evaluateAction(
        {
          type: "Message",
          args: {
            channel,
            account_id: accountId,
            container_id: containerId,
            body: reply,
          },
          idempotency_key: idempotencyKey,
        },
        { agentId, provenance: { sources: derivedProvenanceSources } },
      );

      let sendStatus: "pending" | "awaiting_approval" | "denied" = "pending";
      let approvalId: number | undefined;

      if (policy.decision === "deny") {
        sendStatus = "denied";
      } else if (policy.decision === "require_approval") {
        sendStatus = "awaiting_approval";

        const approval = await this.approvalDal.create({
          planId: `channel-send-${batchKey}`,
          stepIndex: 0,
          prompt: `Approve sending message to ${channel} (${containerId})`,
          context: {
            kind: "channel_send",
            channel,
            account_id: accountId,
            container_id: containerId,
            idempotency_key: idempotencyKey,
            session_key: sessionKey,
            session_id: runtimeSessionId ?? null,
            provenance_sources: derivedProvenanceSources,
            body_preview: reply.slice(0, 400),
            policy,
          },
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
        approvalId = approval.id;
        try {
          this.approvalNotifier?.notify(approval);
        } catch {
          // best-effort
        }
      }

      const sendId = `send-${randomUUID()}`;
      const replyToMessageId = messageIds.length > 0 ? messageIds[messageIds.length - 1] : undefined;

      await this.outboxDal.enqueueSend({
        id: sendId,
        channel,
        accountId,
        containerId,
        replyToMessageId,
        body: reply,
        idempotencyKey,
        status: sendStatus,
        approvalId,
        nowMs,
      });

      await this.markClaimedMessages({
        channel,
        accountId,
        containerId,
        messageIds,
        status: "completed",
        nowMs,
        error: null,
      });

      await this.memoryDal.insertEpisodicEvent(
        this.agentId,
        `channel-inbound-processed-${randomUUID()}`,
        occurredAt,
        channel,
        "channel_inbound_processed",
        {
          channel,
          account_id: accountId,
          container_id: containerId,
          session_key: sessionKey,
          session_id: runtimeSessionId ?? null,
          message_ids: messageIds,
          queue_mode: mode,
          outbox_send_id: sendId,
          policy,
        },
      );
    }
  }

  private async processOutbound(nowMs: number): Promise<void> {
    const ready = await this.outboxDal.listReadyToSend(10, nowMs);

    for (const send of ready) {
      if (send.status !== "pending" && send.status !== "awaiting_approval") {
        continue;
      }
      await this.dispatchSend(send, nowMs);
    }
  }

  private async dispatchSend(send: OutboundSendRow, nowMs: number): Promise<void> {
    if (send.channel === "telegram") {
      if (!this.telegramBot) return;
      try {
        const parts = (() => {
          try {
            const tokens = parseMarkdownToIr(send.body);
            const chunked = chunkMarkdownIr(tokens, this.telegramMaxChars);
            if (chunked.degraded) {
              void this.memoryDal.insertEpisodicEvent(
                this.agentId,
                `formatting-degraded-${randomUUID()}`,
                new Date().toISOString(),
                send.channel,
                "formatting_degraded",
                {
                  channel: send.channel,
                  send_id: send.id,
                  reason: "token_too_large",
                },
              ).catch(() => {
                // best-effort
              });
            }
            return chunked.chunks.map((chunk) => ({
              text: renderTelegramHtml(chunk),
              parseMode: "HTML" as const,
            }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void this.memoryDal.insertEpisodicEvent(
              this.agentId,
              `formatting-fallback-${randomUUID()}`,
              new Date().toISOString(),
              send.channel,
              "formatting_fallback",
              {
                channel: send.channel,
                send_id: send.id,
                error: message,
              },
            ).catch(() => {
              // best-effort
            });
            return chunkPlainText(send.body, this.telegramMaxChars).map((text) => ({
              text,
              parseMode: undefined,
            }));
          }
        })();

        let lastReceipt: unknown = null;
        const replyTo = (() => {
          if (!send.reply_to_message_id) return undefined;
          const n = Number.parseInt(send.reply_to_message_id, 10);
          return Number.isFinite(n) ? n : undefined;
        })();

        for (const part of parts) {
          lastReceipt = await this.telegramBot.sendMessage(send.container_id, part.text, {
            parse_mode: part.parseMode,
            reply_to_message_id: replyTo,
          });
        }

        await this.outboxDal.markSent(send.id, lastReceipt ?? { ok: true }, nowMs);
        await this.memoryDal.insertEpisodicEvent(
          this.agentId,
          `channel-outbound-sent-${randomUUID()}`,
          new Date().toISOString(),
          send.channel,
          "channel_outbound_sent",
          {
            send_id: send.id,
            channel: send.channel,
            account_id: send.account_id,
            container_id: send.container_id,
            idempotency_key: send.idempotency_key,
            receipt: lastReceipt,
          },
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.outboxDal.markFailed(send.id, message, nowMs);
        await this.memoryDal.insertEpisodicEvent(
          this.agentId,
          `channel-outbound-failed-${randomUUID()}`,
          new Date().toISOString(),
          send.channel,
          "channel_outbound_failed",
          {
            send_id: send.id,
            channel: send.channel,
            account_id: send.account_id,
            container_id: send.container_id,
            idempotency_key: send.idempotency_key,
            error: message,
          },
        );
      }
    }
  }
}
