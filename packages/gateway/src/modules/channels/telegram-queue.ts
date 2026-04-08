import { PeerId, buildAgentConversationKey, parseTyrumKey, resolveDmScope } from "@tyrum/contracts";
import type { NormalizedThreadMessage, WsEventEnvelope } from "@tyrum/contracts";
import type { DmScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxConfig, type ChannelInboxRow } from "./inbox-dal.js";
import { ConversationQueueSignalDal } from "../conversation-queue/queue-signal-dal.js";
import { ConversationQueueModeOverrideDal } from "../conversation-queue/queue-mode-override-dal.js";
import type { ConversationDal } from "../agent/conversation-dal.js";
import { PeerIdentityLinkDal } from "./peer-identity-link-dal.js";
import { randomUUID } from "node:crypto";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import { buildChannelSourceKey } from "./interface.js";
import {
  defaultAgentId,
  extractMessageText,
  telegramThreadKey,
  type WsBroadcastDeps,
} from "./telegram-shared.js";
import { telegramAccountIdFromEnv } from "./telegram-account.js";
import { emitTelegramDebugLog } from "./telegram-debug.js";

export class TelegramChannelQueue {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly peerIdentityLinks: PeerIdentityLinkDal;
  private readonly agentId: string;
  private readonly accountId: string;
  private readonly dmScope: DmScope;
  private readonly logger?: Logger;
  private readonly ws?: WsBroadcastDeps;

  constructor(
    db: SqlDb,
    opts: {
      conversationDal: ConversationDal;
      inboxConfig?: ChannelInboxConfig;
      agentId?: string;
      accountId?: string;
      channelKey?: string;
      dmScope?: DmScope;
      ws?: WsBroadcastDeps;
      logger?: Logger;
    },
  ) {
    this.db = db;
    this.inbox = new ChannelInboxDal(db, opts.conversationDal, opts.inboxConfig);
    this.peerIdentityLinks = new PeerIdentityLinkDal(db);
    this.agentId = opts?.agentId?.trim() || defaultAgentId();
    this.accountId =
      opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();
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
      dmScope?: DmScope;
      queueMode?: string;
      debugLoggingEnabled?: boolean;
    },
  ): Promise<{ inbox: ChannelInboxRow; deduped: boolean; message_text: string }> {
    const text = extractMessageText(normalized).trim();
    const agentId = opts?.agentId?.trim() || this.agentId;
    const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || this.accountId;
    const dmScope = opts?.dmScope ?? this.dmScope;
    let key = telegramThreadKey(normalized, {
      agentId,
      accountId,
      dmScope,
    });
    const source = buildChannelSourceKey({ connector: "telegram", accountId });
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
                account: accountId,
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
          key = buildAgentConversationKey({
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
      (await new ConversationQueueModeOverrideDal(this.db).get({ key }))?.queue_mode ??
      "collect";

    const nowMs = Date.now();
    const { row, deduped, overflow } = await this.inbox.enqueue({
      source,
      thread_id: payload.thread.id,
      message_id: payload.message.id,
      key,
      queue_mode: queueMode,
      received_at_ms: nowMs,
      payload,
    });

    const activeLease = await this.db.get<{ lease_expires_at_ms: number }>(
      `SELECT lease_expires_at_ms
       FROM conversation_leases
       WHERE tenant_id = ? AND conversation_key = ?`,
      [row.tenant_id, key],
    );
    const runActive =
      typeof activeLease?.lease_expires_at_ms === "number" &&
      activeLease.lease_expires_at_ms > nowMs;

    if (!deduped && overflow && overflow.dropped.length > 0) {
      const overflowEvent: WsEventEnvelope = {
        event_id: randomUUID(),
        type: "channel.queue.overflow",
        occurred_at: new Date().toISOString(),
        scope: { kind: "conversation", conversation_key: key },
        payload: {
          conversation_key: key,
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
      this.emitWsEvent(row.tenant_id, overflowEvent);
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
        const signals = new ConversationQueueSignalDal(tx);
        await signals.setSignal({
          tenant_id: row.tenant_id,
          key,
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
               AND status = 'queued'
               AND inbox_id <> ?`,
            [row.tenant_id, key, row.inbox_id],
          );
        }
      });
    }

    emitTelegramDebugLog({
      logger: this.logger,
      enabled: opts?.debugLoggingEnabled === true,
      accountKey: accountId,
      event: "queue",
      fields: {
        agent_id: agentId,
        thread_id: payload.thread.id,
        message_id: payload.message.id,
        conversation_key: key,
        inbox_id: row.inbox_id,
        queue_mode: row.queue_mode,
        status: row.status,
        deduped,
        text_length: text.length,
        ...(overflow && overflow.dropped.length > 0
          ? {
              overflow: {
                cap: overflow.cap,
                policy: overflow.policy,
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
            }
          : {}),
      },
    });

    return { inbox: row, deduped, message_text: text };
  }
}
