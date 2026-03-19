/**
 * Telegram ingress normalizer.
 *
 * Converts raw Telegram update payloads into the NormalizedThreadMessage schema.
 */

import { normalizedContainerKindFromThreadKind } from "@tyrum/contracts";
import type {
  MediaKind,
  MessageContent,
  NormalizedAttachment,
  NormalizedMessage,
  NormalizedMessageEnvelope,
  NormalizedThread,
  NormalizedThreadMessage,
  PiiField,
  SenderMetadata,
  ThreadKind,
} from "@tyrum/contracts";
import { telegramAccountIdFromEnv } from "../channels/telegram-account.js";
import type { ArtifactStore } from "../artifact/store.js";
import type { TelegramBot } from "./telegram-bot.js";

export class TelegramNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramNormalizationError";
  }
}

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
  photo?: TelegramPhotoSize[];
  animation?: TelegramFileLike;
  audio?: TelegramFileLike;
  document?: TelegramFileLike;
  video?: TelegramFileLike;
  voice?: TelegramFileLike;
  video_note?: TelegramFileLike;
  sticker?: TelegramFileLike;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramFileLike {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
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

type TelegramMediaCandidate = {
  kind: MediaKind;
  fileId: string;
  fileUniqueId?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  duration?: number;
};

export type TelegramMediaNormalizationDeps = {
  telegramBot: TelegramBot;
  artifactStore: ArtifactStore;
  maxUploadBytes?: number;
};

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
  if (Number.isNaN(date.getTime())) {
    throw new TelegramNormalizationError(`encountered invalid unix timestamp: ${timestamp}`);
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

function trimNonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function deserializeUpdate(payload: string | Uint8Array): TelegramUpdate {
  try {
    const raw = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
    return JSON.parse(raw) as TelegramUpdate;
  } catch (err) {
    throw new TelegramNormalizationError(
      `failed to deserialize telegram update: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function selectMessage(update: TelegramUpdate): TelegramMessage {
  const message = update.edited_message ?? update.message;
  if (message == null) {
    throw new TelegramNormalizationError(
      "telegram update did not include a message or edited_message payload",
    );
  }
  return message;
}

function inferMediaCandidate(message: TelegramMessage): TelegramMediaCandidate | undefined {
  const photo = message.photo?.at(-1);
  if (photo?.file_id) {
    return {
      kind: "photo",
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      mimeType: "image/jpeg",
      sizeBytes: photo.file_size,
      width: photo.width,
      height: photo.height,
    };
  }

  const pickFile = (
    kind: MediaKind,
    file: TelegramFileLike | undefined,
    fallbackMimeType?: string,
  ): TelegramMediaCandidate | undefined => {
    if (!file?.file_id) {
      return undefined;
    }
    return {
      kind,
      fileId: file.file_id,
      fileUniqueId: file.file_unique_id,
      filename: file.file_name,
      mimeType: file.mime_type ?? fallbackMimeType,
      sizeBytes: file.file_size,
      width: file.width,
      height: file.height,
      duration: file.duration,
    };
  };

  return (
    pickFile("video", message.video) ??
    pickFile("animation", message.animation, "video/mp4") ??
    pickFile("document", message.document) ??
    pickFile("audio", message.audio) ??
    pickFile("voice", message.voice, "audio/ogg") ??
    pickFile("video_note", message.video_note, "video/mp4") ??
    pickFile("sticker", message.sticker, "image/webp")
  );
}

function toContent(text: string | undefined, attachments: NormalizedAttachment[]): MessageContent {
  if (typeof text !== "string" && attachments.length === 0) {
    throw new TelegramNormalizationError(
      "telegram update did not include text or a recognized attachment",
    );
  }
  return {
    ...(text ? { text } : {}),
    attachments,
  };
}

function piiFromContent(content: MessageContent): PiiField[] {
  return typeof content.text === "string" ? ["message_text"] : [];
}

function toEnvelopeContent(
  content: MessageContent,
): NormalizedMessageEnvelope["content"] | undefined {
  if (typeof content.text !== "string" && content.attachments.length === 0) {
    return undefined;
  }
  return content;
}

async function materializeTelegramAttachment(
  deps: TelegramMediaNormalizationDeps,
  message: TelegramMessage,
  candidate: TelegramMediaCandidate,
): Promise<NormalizedAttachment> {
  if (
    typeof deps.maxUploadBytes === "number" &&
    typeof candidate.sizeBytes === "number" &&
    candidate.sizeBytes > deps.maxUploadBytes
  ) {
    throw new TelegramNormalizationError(
      `telegram attachment exceeds maxUploadBytes (${String(candidate.sizeBytes)} > ${String(deps.maxUploadBytes)})`,
    );
  }
  const downloaded = await deps.telegramBot.downloadFileById(candidate.fileId);
  if (typeof deps.maxUploadBytes === "number" && downloaded.body.byteLength > deps.maxUploadBytes) {
    throw new TelegramNormalizationError(
      `telegram attachment exceeds maxUploadBytes (${String(downloaded.body.byteLength)} > ${String(deps.maxUploadBytes)})`,
    );
  }
  const artifact = await deps.artifactStore.put({
    kind: "file",
    body: downloaded.body,
    mime_type: candidate.mimeType ?? downloaded.mediaType,
    filename: candidate.filename,
    metadata: {
      source: "telegram-ingress",
      telegram: {
        channel_kind: candidate.kind,
        chat_id: String(message.chat.id),
        file_id: candidate.fileId,
        file_unique_id: candidate.fileUniqueId,
        height: candidate.height,
        message_id: String(message.message_id),
        size_bytes: candidate.sizeBytes,
        width: candidate.width,
        duration: candidate.duration,
      },
    },
  });
  return {
    ...artifact,
    channel_kind: candidate.kind,
  };
}

function buildNormalizedMessage(input: {
  message: TelegramMessage;
  thread: NormalizedThread;
  sender?: SenderMetadata;
  timestamp: string;
  editedTimestamp?: string;
  content: MessageContent;
  messagePii: PiiField[];
}): NormalizedMessage {
  return {
    id: String(input.message.message_id),
    thread_id: input.thread.id,
    source: "telegram",
    content: input.content,
    sender: input.sender,
    timestamp: input.timestamp,
    edited_timestamp: input.editedTimestamp,
    pii_fields: input.messagePii,
    envelope: (() => {
      const envelopeContent = toEnvelopeContent(input.content);
      if (!envelopeContent) {
        return undefined;
      }

      return {
        message_id: String(input.message.message_id),
        received_at: input.timestamp,
        delivery: {
          channel: "telegram",
          account: telegramAccountIdFromEnv(),
        },
        container: {
          kind: normalizedContainerKindFromThreadKind(input.thread.kind),
          id: input.thread.id,
        },
        sender: {
          id: input.sender?.id ?? `chat:${input.thread.id}`,
          ...(input.sender?.username != null ? { display: input.sender.username } : {}),
        },
        content: envelopeContent,
        provenance: ["user"],
      };
    })(),
  };
}

function buildSender(input: {
  message: TelegramMessage;
  messagePii: PiiField[];
}): SenderMetadata | undefined {
  if (!input.message.from) {
    return undefined;
  }

  const user = input.message.from;
  if (user.first_name != null) {
    input.messagePii.push("sender_first_name");
  }
  if (user.last_name != null) {
    input.messagePii.push("sender_last_name");
  }
  if (user.username != null) {
    input.messagePii.push("sender_username");
  }
  if (user.language_code != null) {
    input.messagePii.push("sender_language_code");
  }

  return {
    id: String(user.id),
    is_bot: user.is_bot,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    language_code: user.language_code,
  };
}

function normalizeMessageCore(payload: string | Uint8Array): {
  message: TelegramMessage;
  thread: NormalizedThread;
  timestamp: string;
  editedTimestamp?: string;
} {
  const update = deserializeUpdate(payload);
  const message = selectMessage(update);
  return {
    message,
    thread: toNormalizedThread(message.chat),
    timestamp: toDatetime(message.date),
    editedTimestamp: message.edit_date != null ? toDatetime(message.edit_date) : undefined,
  };
}

export function normalizeUpdate(payload: string | Uint8Array): NormalizedThreadMessage {
  const { message, thread, timestamp, editedTimestamp } = normalizeMessageCore(payload);
  const text = trimNonEmpty(message.text ?? message.caption);
  const content = toContent(text, []);
  const messagePii = piiFromContent(content);
  const sender = buildSender({ message, messagePii });

  return {
    thread,
    message: buildNormalizedMessage({
      message,
      thread,
      sender,
      timestamp,
      editedTimestamp,
      content,
      messagePii,
    }),
  };
}

export async function normalizeUpdateWithMedia(
  payload: string | Uint8Array,
  deps: TelegramMediaNormalizationDeps,
): Promise<NormalizedThreadMessage> {
  const { message, thread, timestamp, editedTimestamp } = normalizeMessageCore(payload);
  const text = trimNonEmpty(message.text ?? message.caption);
  const attachments: NormalizedAttachment[] = [];
  const candidate = inferMediaCandidate(message);
  if (candidate) {
    attachments.push(await materializeTelegramAttachment(deps, message, candidate));
  }

  const content = toContent(text, attachments);
  const messagePii = piiFromContent(content);
  const sender = buildSender({ message, messagePii });

  return {
    thread,
    message: buildNormalizedMessage({
      message,
      thread,
      sender,
      timestamp,
      editedTimestamp,
      content,
      messagePii,
    }),
  };
}
