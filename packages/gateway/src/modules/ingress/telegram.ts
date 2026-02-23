/**
 * Telegram ingress normalizer.
 *
 * Converts raw Telegram update payloads into the NormalizedThreadMessage schema.
 */

import { normalizedContainerKindFromThreadKind } from "@tyrum/schemas";
import type {
  MediaKind,
  MessageContent,
  NormalizedMessage,
  NormalizedMessageEnvelope,
  NormalizedThread,
  NormalizedThreadMessage,
  PiiField,
  SenderMetadata,
  ThreadKind,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TelegramNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramNormalizationError";
  }
}

// ---------------------------------------------------------------------------
// Internal Telegram types (for JSON deserialization)
// ---------------------------------------------------------------------------

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: unknown[];
  animation?: unknown;
  audio?: unknown;
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  video_note?: unknown;
  sticker?: unknown;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapChatType(type: string): ThreadKind {
  switch (type) {
    case "private":
      return "private";
    case "group":
      return "group";
    case "supergroup":
      return "supergroup";
    case "channel":
      return "channel";
    default:
      return "other";
  }
}

function toDatetime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  if (isNaN(date.getTime())) {
    throw new TelegramNormalizationError(
      `encountered invalid unix timestamp: ${timestamp}`,
    );
  }
  return date.toISOString();
}

function toNormalizedThread(chat: TelegramChat): NormalizedThread {
  const piiFields: PiiField[] = [];
  if (chat.title != null) {
    piiFields.push("thread_title");
  }
  if (chat.username != null) {
    piiFields.push("thread_username");
  }

  return {
    id: String(chat.id),
    kind: mapChatType(chat.type),
    title: chat.title,
    username: chat.username,
    pii_fields: piiFields,
  };
}

function inferMediaKind(message: TelegramMessage): MediaKind | undefined {
  if (message.photo != null && message.photo.length > 0) return "photo";
  if (message.video != null) return "video";
  if (message.animation != null) return "animation";
  if (message.document != null) return "document";
  if (message.audio != null) return "audio";
  if (message.voice != null) return "voice";
  if (message.video_note != null) return "video_note";
  if (message.sticker != null) return "sticker";
  return undefined;
}

function extractContent(message: TelegramMessage): MessageContent {
  if (message.text != null) {
    return { kind: "text", text: message.text };
  }

  const mediaKind = inferMediaKind(message);
  if (mediaKind != null) {
    return {
      kind: "media_placeholder",
      media_kind: mediaKind,
      caption: message.caption,
    };
  }

  return {
    kind: "media_placeholder",
    media_kind: "unknown",
    caption: message.caption,
  };
}

function piiFromContent(content: MessageContent): PiiField[] {
  if (content.kind === "text") {
    return ["message_text"];
  }
  const fields: PiiField[] = [];
  if (content.caption != null) {
    fields.push("message_caption");
  }
  return fields;
}

function trimNonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toEnvelopeContent(content: MessageContent): NormalizedMessageEnvelope["content"] | undefined {
  if (content.kind === "text") {
    const text = trimNonEmpty(content.text);
    if (!text) return undefined;
    return { text, attachments: [] };
  }

  const caption = trimNonEmpty(content.caption);
  return {
    ...(caption ? { text: caption } : {}),
    attachments: [{ kind: content.media_kind }],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizeUpdate(
  payload: string | Uint8Array,
): NormalizedThreadMessage {
  let update: TelegramUpdate;
  try {
    const raw =
      typeof payload === "string"
        ? payload
        : new TextDecoder().decode(payload);
    update = JSON.parse(raw) as TelegramUpdate;
  } catch (err) {
    throw new TelegramNormalizationError(
      `failed to deserialize telegram update: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // edited_message takes precedence over message when both are present.
  const message = update.edited_message ?? update.message;
  if (message == null) {
    throw new TelegramNormalizationError(
      "telegram update did not include a message or edited_message payload",
    );
  }

  const thread = toNormalizedThread(message.chat);
  const timestamp = toDatetime(message.date);
  const editedTimestamp =
    message.edit_date != null ? toDatetime(message.edit_date) : undefined;

  const content = extractContent(message);
  const messagePii = piiFromContent(content);

  let sender: SenderMetadata | undefined;
  if (message.from != null) {
    const user = message.from;
    if (user.first_name != null) {
      messagePii.push("sender_first_name");
    }
    if (user.last_name != null) {
      messagePii.push("sender_last_name");
    }
    if (user.username != null) {
      messagePii.push("sender_username");
    }
    if (user.language_code != null) {
      messagePii.push("sender_language_code");
    }

    sender = {
      id: String(user.id),
      is_bot: user.is_bot,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      language_code: user.language_code,
    };
  }

  const normalizedMessage: NormalizedMessage = {
    id: String(message.message_id),
    thread_id: thread.id,
    source: "telegram",
    content,
    sender,
    timestamp,
    edited_timestamp: editedTimestamp,
    pii_fields: messagePii,
    envelope: (() => {
      const envelopeContent = toEnvelopeContent(content);
      if (!envelopeContent) return undefined;

      return {
        message_id: String(message.message_id),
        received_at: timestamp,
        delivery: {
          channel: "telegram",
          account: "default",
	        },
	        container: {
	          kind: normalizedContainerKindFromThreadKind(thread.kind),
	          id: thread.id,
	        },
	        sender: {
	          id: sender?.id ?? `chat:${thread.id}`,
          ...(sender?.username != null ? { display: sender.username } : {}),
        },
        content: envelopeContent,
        provenance: ["user"],
      };
    })(),
  };

  return {
    thread,
    message: normalizedMessage,
  };
}
