import {
  type MessageProvenance,
  buildAgentSessionKey,
  normalizedContainerKindFromThreadKind,
  resolveDmScope,
} from "@tyrum/schemas";
import type { NormalizedMessageEnvelope, NormalizedThreadMessage } from "@tyrum/schemas";
import type { DmScope } from "@tyrum/schemas";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { SqlDb } from "../../statestore/types.js";
import {
  type ChannelEgressConnector,
  buildChannelSourceKey,
  normalizeConnectorId,
} from "./interface.js";
import { telegramAccountIdFromEnv } from "./telegram-account.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal } from "../backplane/outbox-dal.js";

export function normalizeLane(raw: string | undefined): "main" | "cron" | "subagent" {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "main" || normalized === "cron" || normalized === "subagent") {
    return normalized;
  }
  return "main";
}

export type ChannelTypingMode = "never" | "message" | "thinking" | "instant";

export const CHANNEL_TYPING_REFRESH_DEFAULT_MS = 4000;
export const CHANNEL_TYPING_REFRESH_MIN_MS = 1000;
export const CHANNEL_TYPING_REFRESH_MAX_MS = 10_000;
export const CHANNEL_TYPING_MESSAGE_START_DELAY_MS = 250;

export function extractMessageText(normalized: NormalizedThreadMessage): string {
  const content = normalized.message.content;
  if (content.kind === "text") return content.text;
  return content.caption ?? "";
}

export function mergeInboundEnvelopes(
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

export function defaultAgentId(): string {
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

export function connectorBindingKey(connector: ChannelEgressConnector): string {
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

export async function tryAcquireLaneLease(
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

export type WsBroadcastDeps = {
  connectionManager: ConnectionManager;
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
  };
  maxBufferedBytes?: number;
};
