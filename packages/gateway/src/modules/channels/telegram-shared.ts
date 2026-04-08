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
import type { Logger } from "../observability/logger.js";
import {
  type ChannelEgressConnector,
  buildChannelSourceKey,
  normalizeConnectorId,
} from "./interface.js";
import { telegramAccountIdFromEnv } from "./telegram-account.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal } from "../backplane/outbox-dal.js";
import { emitTelegramDebugLog, summarizeTelegramEgressContent } from "./telegram-debug.js";

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
  accountKey: string;
  logger?: Logger;
  debugLoggingEnabled: boolean;
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

  const method =
    input.attachment.media_class === "image"
      ? "sendPhoto"
      : input.attachment.media_class === "video"
        ? "sendVideo"
        : input.attachment.media_class === "audio"
          ? (input.attachment.mime_type ?? "").toLowerCase() === "audio/ogg"
            ? "sendVoice"
            : "sendAudio"
          : "sendDocument";

  emitTelegramDebugLog({
    logger: input.logger,
    enabled: input.debugLoggingEnabled,
    accountKey: input.accountKey,
    event: "egress_attempt",
    fields: {
      method,
      chat_id: input.chatId,
      request: {
        caption: input.caption,
        parse_mode: input.parseMode,
        attachment: {
          artifact_id: input.attachment.artifact_id,
          filename: uploaded.filename ?? input.attachment.filename,
          mime_type: uploaded.mimeType ?? input.attachment.mime_type,
          media_class: input.attachment.media_class,
          size_bytes: uploaded.bytes.byteLength,
        },
      },
    },
  });

  const send =
    method === "sendPhoto"
      ? () => input.telegramBot.sendPhoto(input.chatId, uploaded, options)
      : method === "sendVideo"
        ? () => input.telegramBot.sendVideo(input.chatId, uploaded, options)
        : method === "sendVoice"
          ? () => input.telegramBot.sendVoice(input.chatId, uploaded, options)
          : method === "sendAudio"
            ? () => input.telegramBot.sendAudio(input.chatId, uploaded, options)
            : () => input.telegramBot.sendDocument(input.chatId, uploaded, options);

  try {
    const response = await send();
    emitTelegramDebugLog({
      logger: input.logger,
      enabled: input.debugLoggingEnabled,
      accountKey: input.accountKey,
      event: "egress_result",
      fields: {
        method,
        chat_id: input.chatId,
        response,
      },
    });
    return response;
  } catch (error) {
    emitTelegramDebugLog({
      logger: input.logger,
      enabled: input.debugLoggingEnabled,
      accountKey: input.accountKey,
      event: "egress_failed",
      fields: {
        method,
        chat_id: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
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

export function isInteractiveConversationKey(key: string): boolean {
  return !key.includes(":automation:") && !key.includes(":subagent:");
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
  opts?: {
    accountId?: string;
    artifactStore?: ArtifactStore;
    logger?: Logger;
    debugLoggingEnabled?: boolean;
  },
): ChannelEgressConnector {
  const accountId = opts?.accountId?.trim();
  const debugLoggingEnabled = opts?.debugLoggingEnabled === true;
  return {
    connector: "telegram",
    ...(accountId ? { accountId } : {}),
    ...(debugLoggingEnabled ? { debugLoggingEnabled: true } : {}),
    sendMessage: async (input) => {
      const parseMode = toTelegramParseMode(input.parseMode);
      const text = input.content.text?.trim() ?? "";
      const attachments = input.content.attachments ?? [];
      const effectiveAccountKey = accountId ?? input.accountId;

      if (attachments.length === 0) {
        emitTelegramDebugLog({
          logger: opts?.logger,
          enabled: debugLoggingEnabled,
          accountKey: effectiveAccountKey,
          event: "egress_attempt",
          fields: {
            method: "sendMessage",
            chat_id: input.containerId,
            request: {
              parse_mode: parseMode,
              ...summarizeTelegramEgressContent(input.content),
            },
          },
        });
        try {
          const response = await telegramBot.sendMessage(
            input.containerId,
            text,
            parseMode ? { parse_mode: parseMode } : undefined,
          );
          emitTelegramDebugLog({
            logger: opts?.logger,
            enabled: debugLoggingEnabled,
            accountKey: effectiveAccountKey,
            event: "egress_result",
            fields: {
              method: "sendMessage",
              chat_id: input.containerId,
              response,
            },
          });
          return response;
        } catch (error) {
          emitTelegramDebugLog({
            logger: opts?.logger,
            enabled: debugLoggingEnabled,
            accountKey: effectiveAccountKey,
            event: "egress_failed",
            fields: {
              method: "sendMessage",
              chat_id: input.containerId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }

      const caption =
        text.length > 0 && text.length <= TELEGRAM_CAPTION_MAX_LENGTH ? text : undefined;
      let lastResponse: unknown;
      for (let index = 0; index < attachments.length; index += 1) {
        lastResponse = await sendTelegramAttachment({
          telegramBot,
          accountKey: effectiveAccountKey,
          logger: opts?.logger,
          debugLoggingEnabled,
          chatId: input.containerId,
          attachment: attachments[index]!,
          artifactStore: opts?.artifactStore,
          ...(index === 0 && caption ? { caption } : {}),
          parseMode,
        });
      }

      if (text.length > 0 && !caption) {
        emitTelegramDebugLog({
          logger: opts?.logger,
          enabled: debugLoggingEnabled,
          accountKey: effectiveAccountKey,
          event: "egress_attempt",
          fields: {
            method: "sendMessage",
            chat_id: input.containerId,
            request: {
              parse_mode: parseMode,
              text,
              text_length: text.length,
              attachment_count: attachments.length,
              attachment_caption_overflow: true,
            },
          },
        });
        try {
          lastResponse = await telegramBot.sendMessage(
            input.containerId,
            text,
            parseMode ? { parse_mode: parseMode } : undefined,
          );
          emitTelegramDebugLog({
            logger: opts?.logger,
            enabled: debugLoggingEnabled,
            accountKey: effectiveAccountKey,
            event: "egress_result",
            fields: {
              method: "sendMessage",
              chat_id: input.containerId,
              response: lastResponse,
            },
          });
        } catch (error) {
          emitTelegramDebugLog({
            logger: opts?.logger,
            enabled: debugLoggingEnabled,
            accountKey: effectiveAccountKey,
            event: "egress_failed",
            fields: {
              method: "sendMessage",
              chat_id: input.containerId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }
      return lastResponse;
    },
    sendTyping: async (input) => {
      await telegramBot.sendChatAction(input.containerId, "typing");
    },
  };
}

export async function tryAcquireConversationLease(
  db: SqlDb,
  opts: {
    tenant_id: string;
    key: string;
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
         lease_owner,
         lease_expires_at_ms
       )
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key) DO NOTHING`,
      [opts.tenant_id, opts.key, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE conversation_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE tenant_id = ? AND conversation_key = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [opts.owner, expiresAt, opts.tenant_id, opts.key, opts.now_ms, opts.owner],
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
