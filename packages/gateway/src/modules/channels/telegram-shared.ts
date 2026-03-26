import {
  type MessageProvenance,
  type NormalizedAttachment,
  buildAgentConversationKey,
  normalizedContainerKindFromThreadKind,
  resolveDmScope,
} from "@tyrum/contracts";
import type { NormalizedMessageEnvelope, NormalizedThreadMessage } from "@tyrum/contracts";
import type { DmScope } from "@tyrum/contracts";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { ArtifactStore } from "../artifact/store.js";
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
export const TELEGRAM_CAPTION_MAX_LENGTH = 1024;

export function extractMessageText(normalized: NormalizedThreadMessage): string {
  return normalized.message.content.text ?? "";
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

async function downloadAttachmentBytes(
  attachment: NormalizedAttachment,
  artifactStore?: ArtifactStore,
): Promise<{ bytes: Uint8Array; filename?: string; mimeType?: string }> {
  if (artifactStore) {
    const stored = await artifactStore.get(attachment.artifact_id);
    if (stored) {
      return {
        bytes: new Uint8Array(
          stored.body.buffer as ArrayBuffer,
          stored.body.byteOffset,
          stored.body.byteLength,
        ),
        filename: stored.ref.filename ?? attachment.filename,
        mimeType: stored.ref.mime_type ?? attachment.mime_type,
      };
    }
  }

  const url = attachment.external_url?.trim();
  if (!url) {
    throw new Error(`attachment '${attachment.artifact_id}' is missing external_url`);
  }

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `attachment download failed for '${attachment.artifact_id}' (${String(response.status)}): ${text}`,
    );
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    filename: attachment.filename,
    mimeType: attachment.mime_type ?? response.headers.get("content-type") ?? undefined,
  };
}

async function sendTelegramAttachment(input: {
  telegramBot: TelegramBot;
  chatId: string;
  attachment: NormalizedAttachment;
  artifactStore?: ArtifactStore;
  caption?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}): Promise<unknown> {
  const uploaded = await downloadAttachmentBytes(input.attachment, input.artifactStore);
  const options = input.caption
    ? {
        caption: input.caption,
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      }
    : undefined;

  if (input.attachment.media_class === "image") {
    return await input.telegramBot.sendPhoto(input.chatId, uploaded, options);
  }
  if (input.attachment.media_class === "video") {
    return await input.telegramBot.sendVideo(input.chatId, uploaded, options);
  }
  if (input.attachment.media_class === "audio") {
    if ((input.attachment.mime_type ?? "").toLowerCase() === "audio/ogg") {
      return await input.telegramBot.sendVoice(input.chatId, uploaded, options);
    }
    return await input.telegramBot.sendAudio(input.chatId, uploaded, options);
  }
  return await input.telegramBot.sendDocument(input.chatId, uploaded, options);
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
      return buildAgentConversationKey({
        agentKey: agentId,
        container: "dm",
        channel: "telegram",
        account: accountId,
        peerId,
        dmScope,
      });
    }

    return buildAgentConversationKey({
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
    return buildAgentConversationKey({
      agentKey: agentId,
      container: "dm",
      channel: "telegram",
      account: accountId,
      peerId,
      dmScope,
    });
  }

  return buildAgentConversationKey({
    agentKey: agentId,
    container,
    channel: "telegram",
    account: accountId,
    id: thread.thread.id,
  });
}

export function createTelegramEgressConnector(
  telegramBot: TelegramBot,
  accountId?: string,
  artifactStore?: ArtifactStore,
): ChannelEgressConnector {
  return {
    connector: "telegram",
    ...(accountId?.trim() ? { accountId } : {}),
    sendMessage: async (input) => {
      const parseMode = toTelegramParseMode(input.parseMode);
      const text = input.content.text?.trim() ?? "";
      const attachments = input.content.attachments ?? [];

      if (attachments.length === 0) {
        return await telegramBot.sendMessage(
          input.containerId,
          text,
          parseMode ? { parse_mode: parseMode } : undefined,
        );
      }

      const caption =
        text.length > 0 && text.length <= TELEGRAM_CAPTION_MAX_LENGTH ? text : undefined;
      let lastResponse: unknown;
      for (let index = 0; index < attachments.length; index += 1) {
        lastResponse = await sendTelegramAttachment({
          telegramBot,
          chatId: input.containerId,
          attachment: attachments[index]!,
          artifactStore,
          ...(index === 0 && caption ? { caption } : {}),
          parseMode,
        });
      }

      if (text.length > 0 && !caption) {
        lastResponse = await telegramBot.sendMessage(
          input.containerId,
          text,
          parseMode ? { parse_mode: parseMode } : undefined,
        );
      }
      return lastResponse;
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
      `INSERT INTO conversation_leases (
         tenant_id,
         conversation_key,
         lane,
         lease_owner,
         lease_expires_at_ms
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key, lane) DO NOTHING`,
      [opts.tenant_id, opts.key, opts.lane, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE conversation_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE tenant_id = ? AND conversation_key = ? AND lane = ?
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
