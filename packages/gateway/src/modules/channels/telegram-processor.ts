import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxConfig, type ChannelInboxRow } from "./inbox-dal.js";
import { ChannelOutboxDal } from "./outbox-dal.js";
import { releaseLaneLease } from "../lanes/lane-lease.js";
import type { SessionDal } from "../agent/session-dal.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  type ChannelEgressConnector,
  buildChannelSourceKey,
  parseChannelSourceKey,
} from "./interface.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import { SessionSendPolicyOverrideDal } from "./send-policy-override-dal.js";
import { processTelegramBatch } from "./telegram-batch-processor.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import {
  CHANNEL_TYPING_REFRESH_DEFAULT_MS,
  CHANNEL_TYPING_REFRESH_MAX_MS,
  CHANNEL_TYPING_REFRESH_MIN_MS,
  type ChannelTypingMode,
  connectorBindingKey,
  createTelegramEgressConnector,
  tryAcquireLaneLease,
} from "./telegram-shared.js";
import { Lane, type WsEventEnvelope } from "@tyrum/contracts";

export class TelegramChannelProcessor {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly outbox: ChannelOutboxDal;
  private readonly agents: AgentRegistry;
  private readonly staticEgressConnectors: ReadonlyMap<string, ChannelEgressConnector>;
  private readonly listEgressConnectors?: (tenantId: string) => Promise<ChannelEgressConnector[]>;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly memoryDal?: MemoryDal;
  private readonly approvalDal?: ApprovalDal;
  private readonly protocolDeps?: ProtocolDeps;
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
    telegramBot?: TelegramBot;
    owner: string;
    logger?: Logger;
    memoryDal?: MemoryDal;
    approvalDal?: ApprovalDal;
    protocolDeps?: ProtocolDeps;
    artifactStore?: ArtifactStore;
    typingMode?: ChannelTypingMode;
    typingRefreshMs?: number;
    typingAutomationEnabled?: boolean;
    egressConnectors?: ChannelEgressConnector[];
    listEgressConnectors?: (tenantId: string) => Promise<ChannelEgressConnector[]>;
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
    this.staticEgressConnectors = new Map(
      (
        opts.egressConnectors ??
        (opts.telegramBot
          ? [createTelegramEgressConnector(opts.telegramBot, undefined, opts.artifactStore)]
          : [])
      ).map((connector) => [connectorBindingKey(connector), connector]),
    );
    this.listEgressConnectors = opts.listEgressConnectors;
    this.owner = opts.owner;
    this.logger = opts.logger;
    this.memoryDal = opts.memoryDal;
    this.approvalDal = opts.approvalDal;
    this.protocolDeps = opts.protocolDeps;
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
      const egressConnectorsCache = new Map<string, ReadonlyMap<string, ChannelEgressConnector>>();
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
            const egressConnectors = await this.loadEgressConnectorsCached(
              egressConnectorsCache,
              claimed.tenant_id,
            );
            await processTelegramBatch(
              {
                db: this.db,
                inbox: this.inbox,
                outbox: this.outbox,
                agents: this.agents,
                egressConnectors,
                owner: this.owner,
                logger: this.logger,
                memoryDal: this.memoryDal,
                approvalDal: this.approvalDal,
                protocolDeps: this.protocolDeps,
                typingMode: this.typingMode,
                typingRefreshMs: this.typingRefreshMs,
                typingAutomationEnabled: this.typingAutomationEnabled,
              },
              batch,
            );
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

      for (let i = 0; i < 3; i += 1) {
        const didWork = await this.processOutboxOnce(egressConnectorsCache);
        if (!didWork) break;
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processOutboxOnce(
    egressConnectorsCache: Map<string, ReadonlyMap<string, ChannelEgressConnector>>,
  ): Promise<boolean> {
    if (!this.approvalDal) {
      return await this.sendNextOutbox(egressConnectorsCache);
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
          const reason = approval.latest_review?.reason?.trim() || `approval ${approval.status}`;
          await this.outbox.markFailedByApproval(approval.approval_id, reason);
          return true;
        }
      }
    }

    return await this.sendNextOutbox(egressConnectorsCache);
  }

  private async sendNextOutbox(
    egressConnectorsCache: Map<string, ReadonlyMap<string, ChannelEgressConnector>>,
  ): Promise<boolean> {
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
    const egressConnectors = await this.loadEgressConnectorsCached(
      egressConnectorsCache,
      next.tenant_id,
    );
    const connector = egressConnectors.get(sourceKey) ?? egressConnectors.get(address.connector);
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
        content: {
          ...(next.text.trim().length > 0 ? { text: next.text } : {}),
          ...(next.attachments.length > 0 ? { attachments: next.attachments } : {}),
        },
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

  private async loadEgressConnectors(
    tenantId: string,
  ): Promise<ReadonlyMap<string, ChannelEgressConnector>> {
    if (!this.listEgressConnectors) {
      return this.staticEgressConnectors;
    }
    return new Map(
      (await this.listEgressConnectors(tenantId)).map((connector) => [
        connectorBindingKey(connector),
        connector,
      ]),
    );
  }

  private async loadEgressConnectorsCached(
    cache: Map<string, ReadonlyMap<string, ChannelEgressConnector>>,
    tenantId: string,
  ): Promise<ReadonlyMap<string, ChannelEgressConnector>> {
    const existing = cache.get(tenantId);
    if (existing) return existing;
    const loaded = await this.loadEgressConnectors(tenantId);
    cache.set(tenantId, loaded);
    return loaded;
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
      const parsedLane = Lane.safeParse(inbox.lane);
      const lane = parsedLane.success ? parsedLane.data : undefined;

      const event: WsEventEnvelope = {
        event_id: `delivery.receipt:${input.outbox.dedupe_key}`,
        type: "delivery.receipt",
        occurred_at: new Date().toISOString(),
        scope: { kind: "key", key: inbox.key, lane },
        payload: {
          session_id: inbox.key,
          lane,
          channel: parseChannelSourceKey(input.outbox.source).connector,
          thread_id: input.outbox.thread_id,
          status: input.status,
          ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
          ...(input.error === undefined ? {} : { error: input.error }),
        },
      };

      try {
        await enqueueWsBroadcastMessage(this.db, inbox.tenant_id, event);
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

    const ids = extra.map((row) => row.inbox_id);
    if (ids.length > 0) {
      await this.inbox.claimBatchByIds({
        inbox_ids: ids,
        owner: this.owner,
        now_ms: Date.now(),
        lease_ttl_ms: this.inboxLeaseTtlMs,
      });
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
}
