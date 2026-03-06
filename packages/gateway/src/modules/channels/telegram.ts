import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  type MessageProvenance,
  PeerId,
  WsChannelQueueOverflowEvent,
  WsDeliveryReceiptEvent,
  buildAgentSessionKey,
  normalizedContainerKindFromThreadKind,
  parseTyrumKey,
  resolveDmScope,
} from "@tyrum/schemas";
import type {
  NormalizedMessageEnvelope,
  NormalizedThreadMessage,
  WsEventEnvelope,
} from "@tyrum/schemas";
import type { DmScope } from "@tyrum/schemas";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxConfig, type ChannelInboxRow } from "./inbox-dal.js";
import { ChannelOutboxDal } from "./outbox-dal.js";
import { LaneQueueInterruptError, LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import { releaseLaneLease } from "../lanes/lane-lease.js";
import type { SessionDal } from "../agent/session-dal.js";
import {
  renderMarkdownForTelegram,
  type TelegramFormattingFallbackEvent,
} from "../markdown/telegram.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { PolicyService } from "../policy/service.js";
import { isSafeSuggestedOverridePattern } from "../policy/override-guardrails.js";
import type { MemoryV1Dal } from "../memory/v1-dal.js";
import { recordMemoryV1SystemEpisode } from "../memory/v1-episode-recorder.js";
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
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import { SessionSendPolicyOverrideDal } from "./send-policy-override-dal.js";
import { coerceRecord } from "../util/coerce.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal } from "../backplane/outbox-dal.js";

function normalizeLane(raw: string | undefined): "main" | "cron" | "subagent" {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "main" || normalized === "cron" || normalized === "subagent") {
    return normalized;
  }
  return "main";
}

type ChannelTypingMode = "never" | "message" | "thinking" | "instant";

const CHANNEL_TYPING_REFRESH_DEFAULT_MS = 4000;
const CHANNEL_TYPING_REFRESH_MIN_MS = 1000;
const CHANNEL_TYPING_REFRESH_MAX_MS = 10_000;
const CHANNEL_TYPING_MESSAGE_START_DELAY_MS = 250;

function extractMessageText(normalized: NormalizedThreadMessage): string {
  const content = normalized.message.content;
  if (content.kind === "text") return content.text;
  return content.caption ?? "";
}

function mergeInboundEnvelopes(
  envelopes: NormalizedMessageEnvelope[],
  mergedText: string,
): NormalizedMessageEnvelope | undefined {
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

function defaultAgentId(): string {
  return "default";
}

function toTelegramParseMode(
  value: string | undefined,
): "HTML" | "Markdown" | "MarkdownV2" | undefined {
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
  const agentId = opts?.agentId?.trim() || defaultAgentId();
  const accountId =
    opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();

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
        agentKey: agentId,
        container: "dm",
        channel: "telegram",
        account: accountId,
        peerId,
        dmScope,
      });
    }

    return buildAgentSessionKey({
      agentKey: agentId,
      container,
      channel: "telegram",
      account: accountId,
      id: thread,
    });
  }

  const container = normalizedContainerKindFromThreadKind(thread.thread.kind);
  if (container === "dm") {
    let peerId =
      opts?.peerId?.trim() ||
      thread.thread.id?.trim() ||
      thread.message.thread_id?.trim() ||
      thread.message.sender?.id?.trim();
    if (!peerId) {
      const msgId = thread.message.id?.trim();
      peerId = msgId ? `msg-${msgId}` : "unknown";
    }
    const dmScope = resolveDmScope({
      configured: opts?.dmScope ?? "per_account_channel_peer",
    });
    return buildAgentSessionKey({
      agentKey: agentId,
      container: "dm",
      channel: "telegram",
      account: accountId,
      peerId,
      dmScope,
    });
  }

  return buildAgentSessionKey({
    agentKey: agentId,
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
    sendTyping: async (input) => {
      await telegramBot.sendChatAction(input.containerId, "typing");
    },
  };
}

async function tryAcquireLaneLease(
  db: SqlDb,
  opts: {
    tenant_id: string;
    key: string;
    lane: string;
    owner: string;
    now_ms: number;
    ttl_ms: number;
  },
): Promise<boolean> {
  const expiresAt = opts.now_ms + Math.max(1, opts.ttl_ms);
  return await db.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, key, lane) DO NOTHING`,
      [opts.tenant_id, opts.key, opts.lane, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE lane_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE tenant_id = ? AND key = ? AND lane = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [opts.owner, expiresAt, opts.tenant_id, opts.key, opts.lane, opts.now_ms, opts.owner],
    );
    return updated.changes === 1;
  });
}

type WsBroadcastDeps = {
  connectionManager: ConnectionManager;
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
  };
  maxBufferedBytes?: number;
};

export class TelegramChannelQueue {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly peerIdentityLinks: PeerIdentityLinkDal;
  private readonly agentId: string;
  private readonly accountId: string;
  private readonly lane: string;
  private readonly dmScope: DmScope;
  private readonly logger?: Logger;
  private readonly ws?: WsBroadcastDeps;

  constructor(
    db: SqlDb,
    opts: {
      sessionDal: SessionDal;
      inboxConfig?: ChannelInboxConfig;
      agentId?: string;
      accountId?: string;
      channelKey?: string;
      lane?: string;
      dmScope?: DmScope;
      ws?: WsBroadcastDeps;
      logger?: Logger;
    },
  ) {
    this.db = db;
    this.inbox = new ChannelInboxDal(db, opts.sessionDal, opts.inboxConfig);
    this.peerIdentityLinks = new PeerIdentityLinkDal(db);
    this.agentId = opts?.agentId?.trim() || defaultAgentId();
    this.accountId =
      opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();
    this.lane = normalizeLane(opts?.lane);
    this.dmScope = resolveDmScope({ configured: opts?.dmScope ?? "per_account_channel_peer" });
    this.logger = opts.logger;
    this.ws = opts?.ws;
  }

  private emitWsEvent(tenantId: string, evt: WsEventEnvelope): void {
    const ws = this.ws;
    if (!ws) return;
    broadcastWsEvent(tenantId, evt, { ...ws, logger: this.logger });
  }

  async enqueue(
    normalized: NormalizedThreadMessage,
    opts?: {
      agentId?: string;
      accountId?: string;
      channelKey?: string;
      lane?: string;
      dmScope?: DmScope;
      queueMode?: string;
    },
  ): Promise<{ inbox: ChannelInboxRow; deduped: boolean; message_text: string }> {
    const text = extractMessageText(normalized).trim();
    const agentId = opts?.agentId?.trim() || this.agentId;
    const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || this.accountId;
    const lane = typeof opts?.lane === "string" ? normalizeLane(opts.lane) : this.lane;
    const dmScope = opts?.dmScope ?? this.dmScope;
    let key = telegramThreadKey(normalized, {
      agentId,
      accountId,
      dmScope,
    });
    const source = buildChannelSourceKey({ connector: "telegram", accountId });
    const deliveryAccount = accountId;
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
    if (parsed.kind === "agent" && parsed.thread_kind === "dm" && parsed.dm_scope === "per_peer") {
      const canonicalPeerId = await this.peerIdentityLinks.resolveCanonicalPeerId({
        channel: "telegram",
        account: accountId,
        providerPeerId: parsed.peer_id,
      });
      if (canonicalPeerId) {
        const parsedCanonicalPeerId = PeerId.safeParse(canonicalPeerId.trim());
        if (parsedCanonicalPeerId.success) {
          key = buildAgentSessionKey({
            agentKey: agentId,
            container: "dm",
            channel: "telegram",
            account: accountId,
            peerId: parsedCanonicalPeerId.data,
            dmScope: "per_peer",
          });
        }
      }
    }

    const queueMode =
      (() => {
        const explicit = opts?.queueMode?.trim();
        return explicit && explicit.length > 0 ? explicit : undefined;
      })() ??
      (await new LaneQueueModeOverrideDal(this.db).get({ key, lane }))?.queue_mode ??
      "collect";

    const nowMs = Date.now();

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

    const activeLease = await this.db.get<{ lease_expires_at_ms: number }>(
      `SELECT lease_expires_at_ms
       FROM lane_leases
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [row.tenant_id, key, lane],
    );
    const runActive =
      typeof activeLease?.lease_expires_at_ms === "number" &&
      activeLease.lease_expires_at_ms > nowMs;

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
      const overflowEvent = WsChannelQueueOverflowEvent.safeParse(candidate);
      if (overflowEvent.success) {
        this.emitWsEvent(row.tenant_id, overflowEvent.data);
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
          tenant_id: row.tenant_id,
          key,
          lane,
          kind: effectiveQueueMode === "interrupt" ? "interrupt" : "steer",
          inbox_id: row.inbox_id,
          queue_mode: effectiveQueueMode,
          message_text: text,
          created_at_ms: nowMs,
        });

        if (effectiveQueueMode === "interrupt") {
          await tx.run(
            `DELETE FROM channel_inbox
             WHERE tenant_id = ?
               AND key = ?
               AND lane = ?
               AND status = 'queued'
               AND inbox_id <> ?`,
            [row.tenant_id, key, lane, row.inbox_id],
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
  private readonly memoryV1Dal?: MemoryV1Dal;
  private readonly approvalDal?: ApprovalDal;
  private readonly approvalNotifier?: ApprovalNotifier;
  private readonly typingMode: ChannelTypingMode;
  private readonly typingRefreshMs: number;
  private readonly typingAutomationEnabled: boolean;
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
    sessionDal: SessionDal;
    inboxConfig?: ChannelInboxConfig;
    agents: AgentRegistry;
    telegramBot: TelegramBot;
    owner: string;
    logger?: Logger;
    memoryV1Dal?: MemoryV1Dal;
    approvalDal?: ApprovalDal;
    approvalNotifier?: ApprovalNotifier;
    typingMode?: ChannelTypingMode;
    typingRefreshMs?: number;
    typingAutomationEnabled?: boolean;
    egressConnectors?: ChannelEgressConnector[];
    pollIntervalMs?: number;
    inboxLeaseTtlMs?: number;
    outboxLeaseTtlMs?: number;
    laneLeaseTtlMs?: number;
    debounceMs?: number;
    maxBatch?: number;
  }) {
    this.db = opts.db;
    this.inbox = new ChannelInboxDal(opts.db, opts.sessionDal, opts.inboxConfig);
    this.outbox = new ChannelOutboxDal(opts.db);
    this.agents = opts.agents;
    this.egressConnectors = new Map(
      (opts.egressConnectors ?? [createTelegramEgressConnector(opts.telegramBot)]).map(
        (connector) => [connectorBindingKey(connector), connector],
      ),
    );
    this.owner = opts.owner;
    this.logger = opts.logger;
    this.memoryV1Dal = opts.memoryV1Dal;
    this.approvalDal = opts.approvalDal;
    this.approvalNotifier = opts.approvalNotifier;
    this.typingMode = opts.typingMode ?? "never";
    const rawTypingRefreshMs =
      typeof opts.typingRefreshMs === "number" && Number.isFinite(opts.typingRefreshMs)
        ? Math.floor(opts.typingRefreshMs)
        : CHANNEL_TYPING_REFRESH_DEFAULT_MS;
    this.typingRefreshMs =
      rawTypingRefreshMs <= 0
        ? 0
        : Math.min(
            CHANNEL_TYPING_REFRESH_MAX_MS,
            Math.max(CHANNEL_TYPING_REFRESH_MIN_MS, rawTypingRefreshMs),
          );
    this.typingAutomationEnabled = opts.typingAutomationEnabled ?? false;
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
          tenant_id: claimed.tenant_id,
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
              tenant_id: claimed.tenant_id,
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

    const pending = await this.db.get<{ tenant_id: string; approval_id: string; inbox_id: number }>(
      `SELECT tenant_id, approval_id, inbox_id
       FROM channel_outbox
       WHERE approval_id IS NOT NULL AND status = 'queued'
       ORDER BY created_at ASC, outbox_id ASC
       LIMIT 1`,
    );
    if (pending?.approval_id) {
      const pendingApprovalId = pending.approval_id;
      const scope = await this.db.get<{ key: string }>(
        "SELECT key FROM channel_inbox WHERE inbox_id = ?",
        [pending.inbox_id],
      );
      if (scope?.key) {
        const sendOverride = await new SessionSendPolicyOverrideDal(this.db).get({
          key: scope.key,
        });
        if (sendOverride?.send_policy === "on") {
          await this.outbox.clearApprovalById(pendingApprovalId);
          return true;
        }
        if (sendOverride?.send_policy === "off") {
          await this.outbox.markFailedByApproval(pendingApprovalId, "send disabled by operator");
          return true;
        }
      }

      await this.approvalDal.expireStale({ tenantId: pending.tenant_id });
      const approval = await this.approvalDal.getById({
        tenantId: pending.tenant_id,
        approvalId: pendingApprovalId,
      });
      if (approval) {
        if (approval.status === "approved") {
          await this.outbox.clearApprovalById(approval.approval_id);
          return true;
        }
        if (
          approval.status === "denied" ||
          approval.status === "expired" ||
          approval.status === "cancelled"
        ) {
          const reason = (() => {
            const record = coerceRecord(approval.resolution);
            const candidate = typeof record?.["reason"] === "string" ? record["reason"].trim() : "";
            return candidate.length > 0 ? candidate : `approval ${approval.status}`;
          })();
          await this.outbox.markFailedByApproval(approval.approval_id, reason);
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

    const scope = await this.db.get<{ key: string }>(
      "SELECT key FROM channel_inbox WHERE inbox_id = ?",
      [next.inbox_id],
    );
    if (scope?.key) {
      const sendOverride = await new SessionSendPolicyOverrideDal(this.db).get({ key: scope.key });
      if (sendOverride?.send_policy === "off") {
        await this.outbox.markFailed(next.outbox_id, this.owner, "send disabled by operator");
        return true;
      }
    }

    const address = parseChannelSourceKey(next.source);
    const sourceKey = buildChannelSourceKey(address);
    const connector =
      this.egressConnectors.get(sourceKey) ?? this.egressConnectors.get(address.connector);
    if (!connector) {
      const message = `no egress connector registered for source '${address.connector}'`;
      const marked = await this.outbox.markFailed(next.outbox_id, this.owner, message);
      if (marked) {
        await this.enqueueDeliveryReceiptEvent({
          outbox: next,
          status: "failed",
          receipt: {
            outbox_id: next.outbox_id,
            dedupe_key: next.dedupe_key,
            chunk_index: next.chunk_index,
          },
          error: { code: "channels.connector_missing", message },
        });
      }
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
      const marked = await this.outbox.markSent({
        outboxId: next.outbox_id,
        inboxId: next.inbox_id,
        owner: this.owner,
      });
      if (marked) {
        await this.enqueueDeliveryReceiptEvent({
          outbox: next,
          status: "sent",
          receipt: {
            outbox_id: next.outbox_id,
            dedupe_key: next.dedupe_key,
            chunk_index: next.chunk_index,
            response: resp,
          },
        });

        // Queue-only semantics: drop completed inbox rows once all outbox work has been drained.
        await this.db.run(
          `DELETE FROM channel_inbox
           WHERE inbox_id = ?
             AND status = 'completed'
             AND NOT EXISTS (SELECT 1 FROM channel_outbox WHERE inbox_id = ?)`,
          [next.inbox_id, next.inbox_id],
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const marked = await this.outbox.markFailed(next.outbox_id, this.owner, message);
      if (marked) {
        await this.enqueueDeliveryReceiptEvent({
          outbox: next,
          status: "failed",
          receipt: {
            outbox_id: next.outbox_id,
            dedupe_key: next.dedupe_key,
            chunk_index: next.chunk_index,
          },
          error: { code: "channels.send_failed", message },
        });
      }
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

  private async enqueueDeliveryReceiptEvent(input: {
    outbox: {
      inbox_id: number;
      source: string;
      thread_id: string;
      dedupe_key: string;
      chunk_index: number;
    };
    status: "sent" | "failed";
    receipt?: unknown;
    error?: { code: string; message: string; details?: unknown };
  }): Promise<void> {
    try {
      const inbox = await this.inbox.getById(input.outbox.inbox_id);
      if (!inbox) return;

      const candidate = {
        event_id: `delivery.receipt:${input.outbox.dedupe_key}`,
        type: "delivery.receipt",
        occurred_at: new Date().toISOString(),
        scope: { kind: "key", key: inbox.key, lane: inbox.lane },
        payload: {
          session_id: inbox.key,
          lane: inbox.lane,
          channel: parseChannelSourceKey(input.outbox.source).connector,
          thread_id: input.outbox.thread_id,
          status: input.status,
          ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
          ...(input.error === undefined ? {} : { error: input.error }),
        },
      };

      const parsed = WsDeliveryReceiptEvent.safeParse(candidate);
      if (!parsed.success) {
        this.logger?.warn("channels.egress.delivery_receipt.invalid", {
          dedupe_key: input.outbox.dedupe_key,
          status: input.status,
          error: parsed.error.message,
        });
        return;
      }

      try {
        await enqueueWsBroadcastMessage(this.db, inbox.tenant_id, parsed.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("channels.egress.delivery_receipt.enqueue_failed", {
          dedupe_key: input.outbox.dedupe_key,
          status: input.status,
          error: message,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("channels.egress.delivery_receipt.failed", {
        dedupe_key: input.outbox.dedupe_key,
        status: input.status,
        error: message,
      });
    }
  }

  private async claimDebouncedBatch(leader: ChannelInboxRow): Promise<ChannelInboxRow[]> {
    if (this.debounceMs <= 0) return [leader];
    if (leader.queue_mode !== "collect") return [leader];

    const windowStart = leader.received_at_ms;
    const windowEnd = windowStart + this.debounceMs;

    const extra = await this.inbox.listQueuedForKey({
      tenant_id: leader.tenant_id,
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

    const sourceKey = buildChannelSourceKey(address);
    const connector =
      this.egressConnectors.get(sourceKey) ?? this.egressConnectors.get(connectorId);
    const typingMode = this.typingMode;
    const typingRefreshMs = this.typingRefreshMs;
    const typingEnabled =
      typingMode !== "never" &&
      (leader.lane === "main" || this.typingAutomationEnabled) &&
      typeof connector?.sendTyping === "function";

    let typingTimeout: ReturnType<typeof setTimeout> | undefined;
    let typingInterval: ReturnType<typeof setInterval> | undefined;
    let typingStarted = false;
    const stopTyping = (): void => {
      typingStarted = false;
      if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = undefined;
      }
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = undefined;
      }
    };

    const sendTyping = (): void => {
      if (!typingEnabled) return;
      connector
        ?.sendTyping?.({
          accountId,
          containerId: leader.thread_id,
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.debug("channels.telegram.send_typing_failed", {
            channel_id: connectorId,
            message_id: leader.message_id,
            thread_id: leader.thread_id,
            error: message,
          });
        });
    };

    const startTyping = (): void => {
      if (!typingEnabled) return;
      if (typingStarted) return;
      typingStarted = true;
      sendTyping();
      if (typingRefreshMs > 0) {
        typingInterval = setInterval(sendTyping, typingRefreshMs);
      }
    };

    let reply: string;
    let agentId = "default";
    try {
      try {
        const parsedKey = parseTyrumKey(leader.key as never);
        if (parsedKey.kind === "agent") {
          agentId = parsedKey.agent_key;
        }
      } catch (err) {
        // Intentional: ignore invalid keys; fall back to default agent.
        void err;
      }

      const runtime = await this.agents.getRuntime({
        tenantId: DEFAULT_TENANT_ID,
        agentKey: agentId,
      });

      if (typingMode === "instant" || typingMode === "thinking") startTyping();
      else if (typingMode === "message") {
        typingTimeout = setTimeout(startTyping, CHANNEL_TYPING_MESSAGE_START_DELAY_MS);
      }
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
          channel_id: connectorId,
          source: leader.source,
          connector: connectorId,
          account_id: accountId,
          thread_id: leader.thread_id,
          message_id: leader.message_id,
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
        channel_id: connectorId,
        source: leader.source,
        connector: connectorId,
        account_id: accountId,
        thread_id: leader.thread_id,
        message_id: leader.message_id,
        error: message,
      });
      if (connector) {
        await connector
          .sendMessage({
            accountId,
            containerId: leader.thread_id,
            text: "Sorry, something went wrong. Please try again later.",
            parseMode: "HTML",
          })
          .catch((sendErr) => {
            const message2 = sendErr instanceof Error ? sendErr.message : String(sendErr);
            this.logger?.warn("channels.telegram.send_error_reply_failed", {
              channel_id: connectorId,
              message_id: leader.message_id,
              thread_id: leader.thread_id,
              error: message2,
            });
          });
      }
      for (const row of rows) {
        await this.inbox.markFailed(row.inbox_id, this.owner, message);
      }
      return;
    } finally {
      stopTyping();
    }

    const sendOverride = await new SessionSendPolicyOverrideDal(this.db).get({ key: leader.key });
    if (sendOverride?.send_policy === "off") {
      for (const row of rows) {
        await this.inbox.markCompleted(row.inbox_id, this.owner, reply);
      }
      return;
    }

    const formattingFallbacks: TelegramFormattingFallbackEvent[] = [];
    const chunks = renderMarkdownForTelegram(reply, {
      onFormattingFallback: (event) => {
        formattingFallbacks.push(event);
      },
    });

    if (this.memoryV1Dal && formattingFallbacks.length > 0) {
      const occurredAt = new Date().toISOString();
      await Promise.allSettled(
        formattingFallbacks.map(async (fallback) => {
          await recordMemoryV1SystemEpisode(
            this.memoryV1Dal!,
            {
              occurred_at: occurredAt,
              channel: connectorId,
              event_type: "channel_formatting_fallback",
              summary_md: `Telegram formatting fallback: ${fallback.reason}`,
              tags: ["channel", "telegram", "formatting_fallback"],
              metadata: {
                mode: "pipeline",
                agent_id: agentId,
                inbox_id: leader.inbox_id,
                source: leader.source,
                reason: fallback.reason,
                chunk_index: fallback.chunk_index,
                ...(fallback.detail ? { detail: fallback.detail } : {}),
              },
            },
            agentId,
          );
        }),
      );
    }
    const source = connectorId;

    const sessionScope = await this.db.get<{ agent_id: string; workspace_id: string }>(
      `SELECT agent_id, workspace_id
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?
       LIMIT 1`,
      [leader.tenant_id, leader.session_id],
    );
    if (!sessionScope) {
      for (const row of rows) {
        await this.inbox.markFailed(row.inbox_id, this.owner, "session not found");
      }
      return;
    }

    // Apply outbound send policy before enqueueing side effects.
    let decision: "allow" | "deny" | "require_approval" = "allow";
    let policySnapshotId: string | undefined;
    let connectorMatchTarget: string | undefined;
    let appliedOverrideIds: string[] | undefined;
    const policyService =
      typeof (this.agents as unknown as { getPolicyService?: (id: string) => PolicyService })
        .getPolicyService === "function"
        ? this.agents.getPolicyService(agentId)
        : undefined;
    if (policyService?.isEnabled()) {
      connectorMatchTarget =
        accountId === DEFAULT_CHANNEL_ACCOUNT_ID
          ? `${source}:${leader.thread_id}`
          : `${source}:${accountId}:${leader.thread_id}`;
      try {
        const evalRes = await policyService.evaluateConnectorAction({
          tenantId: leader.tenant_id,
          agentId: sessionScope.agent_id,
          workspaceId: sessionScope.workspace_id,
          matchTarget: connectorMatchTarget,
        });
        decision = evalRes.decision;
        policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
        appliedOverrideIds = evalRes.applied_override_ids;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("channels.egress.policy_eval_failed", {
          channel_id: source,
          message_id: leader.message_id,
          inbox_id: leader.inbox_id,
          agent_id: agentId,
          account_id: accountId,
          thread_id: leader.thread_id,
          match_target: connectorMatchTarget,
          error: message,
        });
        // Fail closed: require approval when policy evaluation fails.
        decision = "require_approval";
      }

      if (decision === "allow" && appliedOverrideIds && appliedOverrideIds.length > 0) {
        this.logger?.debug("channels.egress.policy_override_applied", {
          agent_id: agentId,
          inbox_id: leader.inbox_id,
          match_target: connectorMatchTarget,
          applied_override_ids: appliedOverrideIds,
        });
      }

      if (policyService.isObserveOnly()) {
        decision = "allow";
      }
    }

    if (sendOverride?.send_policy === "on") {
      decision = "allow";
    }

    if (policyService?.isEnabled() && !policyService.isObserveOnly() && decision === "deny") {
      for (const row of rows) {
        await this.inbox.markFailed(row.inbox_id, this.owner, "policy denied outbound send");
      }
      return;
    }

    let approvalId: string | undefined;
    if (decision === "require_approval" && chunks.length > 0) {
      if (!this.approvalDal) {
        for (const row of rows) {
          await this.inbox.markFailed(
            row.inbox_id,
            this.owner,
            "approval required but approvals are unavailable",
          );
        }
        return;
      }

      const suggestedOverrides =
        connectorMatchTarget &&
        policySnapshotId &&
        isSafeSuggestedOverridePattern(connectorMatchTarget)
          ? [{ tool_id: "connector.send", pattern: connectorMatchTarget }]
          : undefined;

      const planSource =
        accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? connectorId : `${connectorId}@${accountId}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const approval = await this.approvalDal.create({
        tenantId: leader.tenant_id,
        agentId: sessionScope.agent_id,
        workspaceId: sessionScope.workspace_id,
        approvalKey: `connector:${planSource}:${leader.thread_id}:${leader.message_id}`,
        kind: "connector.send",
        prompt: `Approve sending a ${source} reply`,
        context: {
          source,
          account_id: accountId,
          thread_id: leader.thread_id,
          inbox_id: leader.inbox_id,
          key: leader.key,
          lane: leader.lane,
          policy_snapshot_id: policySnapshotId,
          policy: policyService?.isEnabled()
            ? {
                policy_snapshot_id: policySnapshotId,
                agent_id: sessionScope.agent_id,
                workspace_id: sessionScope.workspace_id,
                suggested_overrides: suggestedOverrides,
                applied_override_ids: appliedOverrideIds,
              }
            : undefined,
          chunks: chunks.length,
          preview: chunks.slice(0, 1)[0] ?? "",
        },
        expiresAt,
      });
      approvalId = approval.approval_id;
      try {
        this.approvalNotifier?.notify(approval);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.debug("channels.egress.approval_notify_failed", {
          channel_id: source,
          message_id: leader.message_id,
          inbox_id: leader.inbox_id,
          approval_id: approval.approval_id,
          error: message,
        });
      }
    }

    // Durable enqueue of outbound chunks.
    for (let i = 0; i < chunks.length; i += 1) {
      const text = chunks[i]!;
      const dedupeKey = `${leader.source}:${leader.thread_id}:${leader.message_id}:reply:${String(i)}`;
      await this.outbox.enqueue({
        tenant_id: leader.tenant_id,
        inbox_id: leader.inbox_id,
        source: leader.source,
        thread_id: leader.thread_id,
        dedupe_key: dedupeKey,
        chunk_index: i,
        text,
        parse_mode: "HTML",
        workspace_id: leader.workspace_id,
        session_id: leader.session_id,
        channel_thread_id: leader.channel_thread_id,
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
