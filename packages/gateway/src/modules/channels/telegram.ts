import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  type MessageProvenance,
  PeerId,
  WsChannelQueueOverflowEvent,
  buildAgentSessionKey,
  normalizedContainerKindFromThreadKind,
  parseTyrumKey,
  resolveDmScope,
} from "@tyrum/schemas";
import type { NormalizedMessageEnvelope, NormalizedThreadMessage } from "@tyrum/schemas";
import type { DmScope } from "@tyrum/schemas";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxRow } from "./inbox-dal.js";
import { ChannelOutboxDal } from "./outbox-dal.js";
import { LaneQueueInterruptError, LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";
import { releaseLaneLease } from "../lanes/lane-lease.js";
import { renderMarkdownForTelegram, type TelegramFormattingFallbackEvent } from "../markdown/telegram.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { PolicyService } from "../policy/service.js";
import type { MemoryDal } from "../memory/dal.js";
import {
  type ChannelEgressConnector,
  DEFAULT_CHANNEL_ACCOUNT_ID,
  buildChannelSourceKey,
  normalizeConnectorId,
  parseChannelSourceKey,
} from "./interface.js";
import { PeerIdentityLinkDal } from "./peer-identity-link-dal.js";
import { telegramAccountIdFromEnv } from "./telegram-account.js";
import { randomUUID } from "node:crypto";

function isFalsyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && ["0", "false", "off", "no"].includes(v);
}

function normalizeLane(raw: string | undefined): "main" | "cron" | "subagent" {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "main" || normalized === "cron" || normalized === "subagent") {
    return normalized;
  }
  return "main";
}

export function isChannelPipelineEnabled(): boolean {
  return !isFalsyEnvFlag(process.env["TYRUM_CHANNEL_PIPELINE_ENABLED"]);
}

function extractMessageText(normalized: NormalizedThreadMessage): string {
  const content = normalized.message.content;
  if (content.kind === "text") return content.text;
  return content.caption ?? "";
}

function mergeInboundEnvelopes(envelopes: NormalizedMessageEnvelope[], mergedText: string): NormalizedMessageEnvelope | undefined {
  if (envelopes.length === 0) return undefined;

  const base = envelopes[0]!;
  const attachments = envelopes.flatMap((env) => env.content.attachments);
  const provenanceSet = new Set<MessageProvenance>();
  for (const env of envelopes) {
    for (const tag of env.provenance) {
      provenanceSet.add(tag);
    }
  }

  return {
    ...base,
    content: {
      text: mergedText.length > 0 ? mergedText : undefined,
      attachments,
    },
    provenance: provenanceSet.size > 0 ? [...provenanceSet] : base.provenance,
  };
}

function agentIdFromEnv(): string {
  return process.env["TYRUM_AGENT_ID"]?.trim() || "default";
}

function toTelegramParseMode(value: string | undefined): "HTML" | "Markdown" | "MarkdownV2" | undefined {
  if (value === "HTML" || value === "Markdown" || value === "MarkdownV2") {
    return value;
  }
  return undefined;
}

function connectorBindingKey(connector: ChannelEgressConnector): string {
  const connectorId = normalizeConnectorId(connector.connector);
  if (typeof connector.accountId !== "string") {
    return connectorId;
  }
  return buildChannelSourceKey({
    connector: connectorId,
    accountId: connector.accountId,
  });
}

export function telegramThreadKey(
  thread: NormalizedThreadMessage,
  opts?: {
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    dmScope?: DmScope;
    peerId?: string;
  },
): string;

export function telegramThreadKey(
  threadId: string,
  opts: {
    container: "dm" | "group" | "channel";
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    dmScope?: DmScope;
    peerId?: string;
  },
): string;

export function telegramThreadKey(
  thread: string | NormalizedThreadMessage,
  opts?: {
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    container?: "dm" | "group" | "channel";
    dmScope?: DmScope;
    peerId?: string;
  },
): string {
  const agentId = opts?.agentId?.trim() || agentIdFromEnv();
  const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();

  if (typeof thread === "string") {
    const container = opts?.container;
    if (!container) {
      throw new Error("container is required when passing a thread id string");
    }

    if (container === "dm") {
      // Telegram private chats use chat id as the peer identity. Callers may override.
      const peerId = opts?.peerId?.trim() || thread.trim();
      const dmScope = resolveDmScope({
        configured: opts?.dmScope ?? "per_account_channel_peer",
      });
      return buildAgentSessionKey({
        agentId,
        container: "dm",
        channel: "telegram",
        account: accountId,
        peerId,
        dmScope,
      });
    }

    return buildAgentSessionKey({
      agentId,
      container,
      channel: "telegram",
      account: accountId,
      id: thread,
    });
  }

  const container = normalizedContainerKindFromThreadKind(thread.thread.kind);
  if (container === "dm") {
    let peerId = opts?.peerId?.trim()
      || thread.thread.id?.trim()
      || thread.message.thread_id?.trim()
      || thread.message.sender?.id?.trim();
    if (!peerId) {
      const msgId = thread.message.id?.trim();
      peerId = msgId ? `msg-${msgId}` : "unknown";
    }
    const dmScope = resolveDmScope({
      configured: opts?.dmScope ?? "per_account_channel_peer",
    });
    return buildAgentSessionKey({
      agentId,
      container: "dm",
      channel: "telegram",
      account: accountId,
      peerId,
      dmScope,
    });
  }

  return buildAgentSessionKey({
    agentId,
    container,
    channel: "telegram",
    account: accountId,
    id: thread.thread.id,
  });
}

export function createTelegramEgressConnector(telegramBot: TelegramBot): ChannelEgressConnector {
  return {
    connector: "telegram",
    sendMessage: async (input) => {
      const parseMode = toTelegramParseMode(input.parseMode);
      return await telegramBot.sendMessage(
        input.containerId,
        input.text,
        parseMode ? { parse_mode: parseMode } : undefined,
      );
    },
  };
}

async function tryAcquireLaneLease(db: SqlDb, opts: {
  key: string;
  lane: string;
  owner: string;
  now_ms: number;
  ttl_ms: number;
}): Promise<boolean> {
  const expiresAt = opts.now_ms + Math.max(1, opts.ttl_ms);
  return await db.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key, lane) DO NOTHING`,
      [opts.key, opts.lane, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE lane_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE key = ? AND lane = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [opts.owner, expiresAt, opts.key, opts.lane, opts.now_ms, opts.owner],
    );
    return updated.changes === 1;
  });
}

type WsBroadcastClient = { ws: { send: (payload: string) => void } };

type WsBroadcastDeps = {
  connectionManager: { allClients: () => Iterable<WsBroadcastClient> };
  cluster?: { edgeId: string; outboxDal: { enqueue: (kind: string, payload: unknown) => Promise<unknown> } };
};

export class TelegramChannelQueue {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly peerIdentityLinks: PeerIdentityLinkDal;
  private readonly agentId: string;
  private readonly accountId: string;
  private readonly lane: string;
  private readonly dmScope: DmScope;
  private readonly ws?: WsBroadcastDeps;

  constructor(db: SqlDb, opts?: { agentId?: string; accountId?: string; channelKey?: string; lane?: string; dmScope?: DmScope; ws?: WsBroadcastDeps }) {
    this.db = db;
    this.inbox = new ChannelInboxDal(db);
    this.peerIdentityLinks = new PeerIdentityLinkDal(db);
    this.agentId = opts?.agentId?.trim() || agentIdFromEnv();
    this.accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();
    this.lane = normalizeLane(opts?.lane);
    this.dmScope = resolveDmScope({ configured: opts?.dmScope ?? "per_account_channel_peer" });
    this.ws = opts?.ws;
  }

  private emitWsEvent(evt: unknown): void {
    const ws = this.ws;
    if (!ws) return;

    const payload = JSON.stringify(evt);
    for (const client of ws.connectionManager.allClients()) {
      try {
        client.ws.send(payload);
      } catch {
        // ignore
      }
    }

    if (ws.cluster) {
      void ws.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: ws.cluster.edgeId,
          skip_local: true,
          message: evt,
        })
        .catch(() => {
          // ignore
        });
    }
  }

  async enqueue(
    normalized: NormalizedThreadMessage,
    opts?: { agentId?: string; accountId?: string; channelKey?: string; lane?: string; dmScope?: DmScope; queueMode?: string },
  ): Promise<{ inbox: ChannelInboxRow; deduped: boolean; message_text: string }> {
    const text = extractMessageText(normalized).trim();
    const agentId = opts?.agentId?.trim() || this.agentId;
    const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || this.accountId;
    const lane = typeof opts?.lane === "string" ? normalizeLane(opts.lane) : this.lane;
    const dmScope = opts?.dmScope ?? this.dmScope;
    const queueMode = opts?.queueMode?.trim() || "collect";
    let key = telegramThreadKey(normalized, {
      agentId,
      accountId,
      dmScope,
    });
    const source =
      accountId === telegramAccountIdFromEnv()
        ? "telegram"
        : buildChannelSourceKey({ connector: "telegram", accountId });
    const deliveryAccount = source === "telegram" ? DEFAULT_CHANNEL_ACCOUNT_ID : accountId;
    const payload: NormalizedThreadMessage = normalized.message.envelope
      ? {
          ...normalized,
          message: {
            ...normalized.message,
            envelope: {
              ...normalized.message.envelope,
              delivery: {
                ...normalized.message.envelope.delivery,
                channel: "telegram",
                account: deliveryAccount,
              },
            },
          },
        }
      : normalized;
    const parsed = parseTyrumKey(key as never);
    if (
      parsed.kind === "agent" &&
      parsed.thread_kind === "dm" &&
      parsed.dm_scope === "per_peer"
    ) {
      const canonicalPeerId = await this.peerIdentityLinks.resolveCanonicalPeerId({
        channel: "telegram",
        account: accountId,
        providerPeerId: parsed.peer_id,
      });
      if (canonicalPeerId) {
        const parsedCanonicalPeerId = PeerId.safeParse(canonicalPeerId.trim());
        if (parsedCanonicalPeerId.success) {
          key = buildAgentSessionKey({
            agentId,
            container: "dm",
            channel: "telegram",
            account: accountId,
            peerId: parsedCanonicalPeerId.data,
            dmScope: "per_peer",
          });
        }
      }
    }

    const nowMs = Date.now();
    const activeLease = await this.db.get<{ lease_expires_at_ms: number }>(
      `SELECT lease_expires_at_ms
       FROM lane_leases
       WHERE key = ? AND lane = ?`,
      [key, lane],
    );
    const runActive = typeof activeLease?.lease_expires_at_ms === "number" && activeLease.lease_expires_at_ms > nowMs;

    const { row, deduped, overflow } = await this.inbox.enqueue({
      source,
      thread_id: payload.thread.id,
      message_id: payload.message.id,
      key,
      lane,
      queue_mode: queueMode,
      received_at_ms: nowMs,
      payload,
    });

    if (!deduped && overflow && overflow.dropped.length > 0) {
      const candidate = {
        event_id: randomUUID(),
        type: "channel.queue.overflow",
        occurred_at: new Date().toISOString(),
        scope: { kind: "key", key, lane },
        payload: {
          key,
          lane,
          cap: overflow.cap,
          overflow: overflow.policy,
          queued_before: overflow.queued_before,
          queued_after: overflow.queued_after,
          dropped_inbox_ids: overflow.dropped.map((dropped) => dropped.inbox_id),
          dropped_message_ids: overflow.dropped.map((dropped) => dropped.message_id),
          ...(overflow.summary
            ? {
                summary_inbox_id: overflow.summary.inbox_id,
                summary_message_id: overflow.summary.message_id,
              }
            : {}),
        },
      };
      const parsed = WsChannelQueueOverflowEvent.safeParse(candidate);
      if (parsed.success) {
        this.emitWsEvent(parsed.data);
      }
    }

    const effectiveQueueMode = row.queue_mode;
    if (
      !deduped &&
      row.status === "queued" &&
      runActive &&
      (effectiveQueueMode === "steer" ||
        effectiveQueueMode === "steer_backlog" ||
        effectiveQueueMode === "interrupt")
    ) {
      await this.db.transaction(async (tx) => {
        const signals = new LaneQueueSignalDal(tx);
        await signals.setSignal({
          key,
          lane,
          kind: effectiveQueueMode === "interrupt" ? "interrupt" : "steer",
          inbox_id: row.inbox_id,
          queue_mode: effectiveQueueMode,
          message_text: text,
          created_at_ms: nowMs,
        });

        if (effectiveQueueMode === "interrupt") {
          const nowIso = new Date(nowMs).toISOString();
          await tx.run(
            `UPDATE channel_inbox
             SET status = 'completed',
                 lease_owner = NULL,
                 lease_expires_at_ms = NULL,
                 processed_at = COALESCE(processed_at, ?),
                 error = NULL,
                 reply_text = COALESCE(reply_text, '')
             WHERE key = ? AND lane = ?
               AND status = 'queued'
               AND inbox_id <> ?`,
            [nowIso, key, lane, row.inbox_id],
          );
        }
      });
    }

    return { inbox: row, deduped, message_text: text };
  }
}

export class TelegramChannelProcessor {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly outbox: ChannelOutboxDal;
  private readonly agents: AgentRegistry;
  private readonly egressConnectors: Map<string, ChannelEgressConnector>;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly memoryDal?: MemoryDal;
  private readonly approvalDal?: ApprovalDal;
  private readonly approvalNotifier?: ApprovalNotifier;
  private readonly pollIntervalMs: number;
  private readonly inboxLeaseTtlMs: number;
  private readonly outboxLeaseTtlMs: number;
  private readonly laneLeaseTtlMs: number;
  private readonly debounceMs: number;
  private readonly maxBatch: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: {
    db: SqlDb;
    agents: AgentRegistry;
    telegramBot: TelegramBot;
    owner: string;
    logger?: Logger;
    memoryDal?: MemoryDal;
    approvalDal?: ApprovalDal;
    approvalNotifier?: ApprovalNotifier;
    egressConnectors?: ChannelEgressConnector[];
    pollIntervalMs?: number;
    inboxLeaseTtlMs?: number;
    outboxLeaseTtlMs?: number;
    laneLeaseTtlMs?: number;
    debounceMs?: number;
    maxBatch?: number;
  }) {
    this.db = opts.db;
    this.inbox = new ChannelInboxDal(opts.db);
    this.outbox = new ChannelOutboxDal(opts.db);
    this.agents = opts.agents;
    this.egressConnectors = new Map(
      (opts.egressConnectors ?? [createTelegramEgressConnector(opts.telegramBot)]).map((connector) => [
        connectorBindingKey(connector),
        connector,
      ]),
    );
    this.owner = opts.owner;
    this.logger = opts.logger;
    this.memoryDal = opts.memoryDal;
    this.approvalDal = opts.approvalDal;
    this.approvalNotifier = opts.approvalNotifier;
    this.pollIntervalMs = opts.pollIntervalMs ?? 250;
    this.inboxLeaseTtlMs = opts.inboxLeaseTtlMs ?? 10 * 60 * 1000;
    this.outboxLeaseTtlMs = opts.outboxLeaseTtlMs ?? 60 * 1000;
    this.laneLeaseTtlMs = opts.laneLeaseTtlMs ?? 10 * 60 * 1000;
    this.debounceMs = Math.max(0, opts.debounceMs ?? 1000);
    this.maxBatch = Math.max(1, opts.maxBatch ?? 5);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("channel.telegram.tick_failed", { error: message });
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const nowMs = Date.now();
      const claimed = await this.inbox.claimNext({
        owner: this.owner,
        now_ms: nowMs,
        lease_ttl_ms: this.inboxLeaseTtlMs,
      });
      if (claimed) {
        const laneAcquired = await tryAcquireLaneLease(this.db, {
          key: claimed.key,
          lane: claimed.lane,
          owner: this.owner,
          now_ms: nowMs,
          ttl_ms: this.laneLeaseTtlMs,
        });
        if (!laneAcquired) {
          await this.inbox.requeue(claimed.inbox_id, this.owner);
        } else {
          try {
            const batch = await this.claimDebouncedBatch(claimed);
            await this.processBatch(batch);
          } finally {
            await releaseLaneLease(this.db, {
              key: claimed.key,
              lane: claimed.lane,
              owner: this.owner,
            });
          }
        }
      }

      // Outbox sends are drained separately so approval-gated sends can resume
      // after an operator decision, even when no new inbound messages arrive.
      for (let i = 0; i < 3; i += 1) {
        const didWork = await this.processOutboxOnce();
        if (!didWork) break;
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processOutboxOnce(): Promise<boolean> {
    if (!this.approvalDal) {
      return await this.sendNextOutbox();
    }

    // Expire approvals before checking gating.
    await this.approvalDal.expireStale();

    const pending = await this.db.get<{ approval_id: number }>(
      `SELECT approval_id
       FROM channel_outbox
       WHERE approval_id IS NOT NULL AND status = 'queued'
       ORDER BY created_at ASC, outbox_id ASC
       LIMIT 1`,
    );
    if (pending?.approval_id) {
      const approval = await this.approvalDal.getById(pending.approval_id);
      if (approval) {
        if (approval.status === "approved") {
          await this.outbox.clearApprovalById(approval.id);
          return true;
        }
        if (approval.status === "denied" || approval.status === "expired" || approval.status === "cancelled") {
          const reason = approval.response_reason ?? `approval ${approval.status}`;
          await this.outbox.markFailedByApproval(approval.id, reason);
          return true;
        }
      }
    }

    return await this.sendNextOutbox();
  }

  private async sendNextOutbox(): Promise<boolean> {
    const next = await this.outbox.claimNextGlobal({
      owner: this.owner,
      now_ms: Date.now(),
      lease_ttl_ms: this.outboxLeaseTtlMs,
    });
    if (!next) return false;

    const address = parseChannelSourceKey(next.source);
    const sourceKey = buildChannelSourceKey(address);
    const connector = this.egressConnectors.get(sourceKey) ?? this.egressConnectors.get(address.connector);
    if (!connector) {
      const message = `no egress connector registered for source '${address.connector}'`;
      await this.outbox.markFailed(next.outbox_id, this.owner, message);
      this.logger?.warn("channels.egress.connector_missing", {
        outbox_id: next.outbox_id,
        source: next.source,
        source_key: sourceKey,
        connector: address.connector,
        account_id: address.accountId,
      });
      return true;
    }

    try {
      const resp = await connector.sendMessage({
        accountId: address.accountId,
        containerId: next.thread_id,
        text: next.text,
        parseMode: next.parse_mode ?? undefined,
      });
      await this.outbox.markSent(next.outbox_id, this.owner, resp);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.outbox.markFailed(next.outbox_id, this.owner, message);
      this.logger?.warn("channels.egress.send_failed", {
        outbox_id: next.outbox_id,
        source: next.source,
        connector: address.connector,
        account_id: address.accountId,
        thread_id: next.thread_id,
        error: message,
      });
    }

    return true;
  }

  private async claimDebouncedBatch(leader: ChannelInboxRow): Promise<ChannelInboxRow[]> {
    if (this.debounceMs <= 0) return [leader];
    if (leader.queue_mode !== "collect") return [leader];

    const windowStart = leader.received_at_ms;
    const windowEnd = windowStart + this.debounceMs;

    const extra = await this.inbox.listQueuedForKey({
      key: leader.key,
      lane: leader.lane,
      received_at_ms_gte: windowStart,
      received_at_ms_lte: windowEnd,
      limit: Math.max(0, this.maxBatch - 1),
      queue_mode: "collect",
    });

    const ids = extra.map((r) => r.inbox_id);
    if (ids.length > 0) {
      await this.inbox.claimBatchByIds({
        inbox_ids: ids,
        owner: this.owner,
        now_ms: Date.now(),
        lease_ttl_ms: this.inboxLeaseTtlMs,
      });
      // Re-fetch claimed rows so payload is present.
      const claimedExtra: ChannelInboxRow[] = [];
      for (const id of ids) {
        const row = await this.inbox.getById(id);
        if (row && row.status === "processing" && row.lease_owner === this.owner) {
          claimedExtra.push(row);
        }
      }
      return [leader, ...claimedExtra];
    }

    return [leader];
  }

  private async processBatch(rows: ChannelInboxRow[]): Promise<void> {
    const leader = rows[0]!;
    const address = parseChannelSourceKey(leader.source);
    const connectorId = address.connector;
    const accountId = address.accountId;
    const messages: string[] = [];
    const envelopes: NormalizedMessageEnvelope[] = [];
    let hasAttachments = false;

    for (const row of rows) {
      const parsed = NormalizedThreadMessageSchema.safeParse(row.payload);
      if (!parsed.success) continue;

      const envelope = parsed.data.message.envelope;
      if (envelope) {
        const patchedEnvelope: NormalizedMessageEnvelope = {
          ...envelope,
          delivery: {
            ...envelope.delivery,
            channel: connectorId,
            account: accountId,
          },
        };
        envelopes.push(patchedEnvelope);

        const text = patchedEnvelope.content.text?.trim();
        if (text) messages.push(text);

        if (patchedEnvelope.content.attachments.length > 0) {
          hasAttachments = true;
        }
        continue;
      }

      const text = extractMessageText(parsed.data).trim();
      if (text.length > 0) messages.push(text);
    }

    const combined = messages.join("\n\n").trim();
    const mergedEnvelope = mergeInboundEnvelopes(envelopes, combined);
    if (combined.length === 0 && !hasAttachments) {
      for (const row of rows) {
        await this.inbox.markCompleted(row.inbox_id, this.owner, "");
      }
      return;
    }

    let reply: string;
    let agentId = "default";
    try {
      try {
        const parsedKey = parseTyrumKey(leader.key as never);
        if (parsedKey.kind === "agent") {
          agentId = parsedKey.agent_id;
        }
      } catch {
        // ignore invalid keys; fall back to default agent
      }

      const runtime = await this.agents.getRuntime(agentId);
      const result = await runtime.turn({
        ...(combined.length > 0 ? { message: combined } : {}),
        metadata: {
          tyrum_key: leader.key,
          lane: leader.lane,
        },
        envelope: mergedEnvelope,
        channel: connectorId,
        thread_id: leader.thread_id,
      });
      reply = result.reply ?? "";
    } catch (err) {
      if (err instanceof LaneQueueInterruptError) {
        this.logger?.info("channels.ingress.agent_interrupted", {
          inbox_id: leader.inbox_id,
          source: leader.source,
          connector: connectorId,
          account_id: accountId,
          thread_id: leader.thread_id,
          error: err.message,
        });
        for (const row of rows) {
          await this.inbox.markCompleted(row.inbox_id, this.owner, "");
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("channels.ingress.agent_failed", {
        inbox_id: leader.inbox_id,
        source: leader.source,
        connector: connectorId,
        account_id: accountId,
        thread_id: leader.thread_id,
        error: message,
      });
      const sourceKey = buildChannelSourceKey(address);
      const connector = this.egressConnectors.get(sourceKey) ?? this.egressConnectors.get(connectorId);
      if (connector) {
        await connector
          .sendMessage({
            accountId,
            containerId: leader.thread_id,
            text: "Sorry, something went wrong. Please try again later.",
            parseMode: "HTML",
          })
          .catch(() => undefined);
      }
      for (const row of rows) {
        await this.inbox.markFailed(row.inbox_id, this.owner, message);
      }
      return;
    }

    const formattingFallbacks: TelegramFormattingFallbackEvent[] = [];
    const chunks = renderMarkdownForTelegram(reply, {
      onFormattingFallback: (event) => {
        formattingFallbacks.push(event);
      },
    });

    if (this.memoryDal && formattingFallbacks.length > 0) {
      const occurredAt = new Date().toISOString();
      await Promise.allSettled(
        formattingFallbacks.map(async (fallback) => {
          await this.memoryDal?.insertEpisodicEvent(
            `channel-formatting-fallback-${randomUUID()}`,
            occurredAt,
            connectorId,
            "channel_formatting_fallback",
            {
              mode: "pipeline",
              agent_id: agentId,
              inbox_id: leader.inbox_id,
              source: leader.source,
              reason: fallback.reason,
              chunk_index: fallback.chunk_index,
              ...(fallback.detail ? { detail: fallback.detail } : {}),
            },
            agentId,
          );
        }),
      );
    }
    const source = connectorId;

    // Apply outbound send policy before enqueueing side effects.
    let decision: "allow" | "deny" | "require_approval" = "allow";
    let policySnapshotId: string | undefined;
    const policyService =
      typeof (this.agents as unknown as { getPolicyService?: (id: string) => PolicyService }).getPolicyService ===
      "function"
        ? this.agents.getPolicyService(agentId)
        : undefined;
    if (policyService?.isEnabled()) {
      try {
        const matchTarget =
          accountId === DEFAULT_CHANNEL_ACCOUNT_ID
            ? `${source}:${leader.thread_id}`
            : `${source}:${accountId}:${leader.thread_id}`;
        const evalRes = await policyService.evaluateConnectorAction({
          agentId,
          workspaceId: agentId,
          matchTarget,
        });
        decision = evalRes.decision;
        policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
      } catch {
        // Fail closed: require approval when policy evaluation fails.
        decision = "require_approval";
      }

      if (policyService.isObserveOnly()) {
        decision = "allow";
      } else if (decision === "deny") {
        for (const row of rows) {
          await this.inbox.markFailed(row.inbox_id, this.owner, "policy denied outbound send");
        }
        return;
      }
    }

    let approvalId: number | undefined;
    if (decision === "require_approval" && chunks.length > 0) {
      if (!this.approvalDal) {
        for (const row of rows) {
          await this.inbox.markFailed(row.inbox_id, this.owner, "approval required but approvals are unavailable");
        }
        return;
      }

      const planSource =
        accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? connectorId : `${connectorId}@${accountId}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const approval = await this.approvalDal.create({
        planId: `connector:${planSource}:${leader.thread_id}:${leader.message_id}`,
        stepIndex: 0,
        kind: "connector.send",
        agentId,
        workspaceId: agentId,
        key: leader.key,
        lane: leader.lane,
        prompt: `Approve sending a ${source} reply`,
        context: {
          source,
          account_id: accountId,
          thread_id: leader.thread_id,
          inbox_id: leader.inbox_id,
          policy_snapshot_id: policySnapshotId,
          chunks: chunks.length,
          preview: chunks.slice(0, 1)[0] ?? "",
        },
        expiresAt,
      });
      approvalId = approval.id;
      try {
        this.approvalNotifier?.notify(approval);
      } catch {
        // ignore best-effort notify failures
      }
    }

    // Durable enqueue of outbound chunks.
    for (let i = 0; i < chunks.length; i += 1) {
      const text = chunks[i]!;
      const dedupeKey = `${leader.source}:${leader.thread_id}:${leader.message_id}:reply:${String(i)}`;
      await this.outbox.enqueue({
        inbox_id: leader.inbox_id,
        source: leader.source,
        thread_id: leader.thread_id,
        dedupe_key: dedupeKey,
        chunk_index: i,
        text,
        parse_mode: "HTML",
      });
    }

    if (approvalId) {
      await this.outbox.setApprovalForInbox(leader.inbox_id, approvalId);
    }

    for (const row of rows) {
      await this.inbox.markCompleted(row.inbox_id, this.owner, reply);
    }
  }
}
