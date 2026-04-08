import {
  normalizedContainerKindFromThreadKind,
  type NormalizedAttachment,
  type NormalizedThreadMessage,
} from "@tyrum/contracts";
import type { Logger, LogFields } from "../observability/logger.js";
import type { ChannelEgressContent } from "./interface.js";

type RawTelegramUpdate = {
  update_id?: unknown;
  message?: unknown;
  edited_message?: unknown;
  channel_post?: unknown;
  edited_channel_post?: unknown;
};

export function emitTelegramDebugLog(input: {
  logger?: Pick<Logger, "info">;
  enabled: boolean;
  accountKey: string;
  event: string;
  fields?: LogFields;
}): void {
  if (!input.enabled) {
    return;
  }
  input.logger?.info(`channel.telegram.debug.${input.event}`, {
    debug_scope: "channel",
    channel: "telegram",
    account_key: input.accountKey,
    ...input.fields,
  });
}

function parseRawTelegramUpdate(rawBody: string): RawTelegramUpdate | undefined {
  try {
    return JSON.parse(rawBody) as RawTelegramUpdate;
  } catch {
    return undefined;
  }
}

export function summarizeTelegramUpdate(rawBody: string): LogFields {
  const parsed = parseRawTelegramUpdate(rawBody);
  const updateKind = parsed
    ? (["edited_message", "message", "edited_channel_post", "channel_post"] as const).find(
        (key) => parsed[key] !== undefined,
      )
    : undefined;
  return {
    ...(typeof parsed?.update_id === "number" ? { update_id: parsed.update_id } : {}),
    ...(updateKind ? { update_kind: updateKind } : {}),
    raw_update: parsed ?? rawBody,
  };
}

function summarizeAttachment(attachment: NormalizedAttachment): LogFields {
  return {
    artifact_id: attachment.artifact_id,
    filename: attachment.filename,
    mime_type: attachment.mime_type,
    media_class: attachment.media_class,
    size_bytes: attachment.size_bytes,
  };
}

export function summarizeTelegramEgressContent(content: ChannelEgressContent): LogFields {
  const attachments = content.attachments ?? [];
  return {
    ...(typeof content.text === "string"
      ? {
          text: content.text,
          text_length: content.text.length,
        }
      : {}),
    attachment_count: attachments.length,
    ...(attachments.length > 0 ? { attachments: attachments.map(summarizeAttachment) } : {}),
  };
}

export function summarizeNormalizedTelegramMessage(normalized: NormalizedThreadMessage): LogFields {
  const envelope = normalized.message.envelope;
  return {
    thread_id: normalized.thread.id,
    container_kind: normalizedContainerKindFromThreadKind(normalized.thread.kind),
    message_id: normalized.message.id,
    sender_id: normalized.message.sender?.id ?? envelope?.sender.id ?? null,
    attachment_count: normalized.message.content.attachments.length,
    ...(typeof normalized.message.content.text === "string"
      ? {
          text: normalized.message.content.text,
          text_length: normalized.message.content.text.length,
        }
      : {}),
    normalized_message: {
      thread: normalized.thread,
      message: {
        id: normalized.message.id,
        thread_id: normalized.message.thread_id,
        source: normalized.message.source,
        sender: normalized.message.sender,
        timestamp: normalized.message.timestamp,
        edited_timestamp: normalized.message.edited_timestamp,
        envelope,
        content: normalized.message.content,
      },
    },
  };
}
