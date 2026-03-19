import { PeerId, buildAgentSessionKey, parseTyrumKey, resolveDmScope } from "@tyrum/contracts";
import type { NormalizedThreadMessage, WsEventEnvelope } from "@tyrum/contracts";
import type { DmScope } from "@tyrum/contracts";
import { Lane } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxConfig, type ChannelInboxRow } from "./inbox-dal.js";
import { LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import type { SessionDal } from "../agent/session-dal.js";
import { PeerIdentityLinkDal } from "./peer-identity-link-dal.js";
import { randomUUID } from "node:crypto";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import { buildChannelSourceKey } from "./interface.js";
import {
  defaultAgentId,
  extractMessageText,
  normalizeLane,
  telegramThreadKey,
  type WsBroadcastDeps,
} from "./telegram-shared.js";
import { telegramAccountIdFromEnv } from "./telegram-account.js";

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
      const parsedLane = Lane.safeParse(lane);
      const laneScope = parsedLane.success ? parsedLane.data : undefined;
      const overflowEvent: WsEventEnvelope = {
        event_id: randomUUID(),
        type: "channel.queue.overflow",
        occurred_at: new Date().toISOString(),
        scope: { kind: "key", key, lane: laneScope },
        payload: {
          key,
          lane: laneScope,
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
