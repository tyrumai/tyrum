import { z } from "zod";

/** Source channel for a normalized message. */
export const MessageSource = z.enum(["telegram"]);
export type MessageSource = z.infer<typeof MessageSource>;

/** Supported thread classifications. */
export const ThreadKind = z.enum([
  "private",
  "group",
  "supergroup",
  "channel",
  "other",
]);
export type ThreadKind = z.infer<typeof ThreadKind>;

/** High-level media categories for placeholder normalization. */
export const MediaKind = z.enum([
  "animation",
  "audio",
  "document",
  "photo",
  "sticker",
  "video",
  "video_note",
  "voice",
  "unknown",
]);
export type MediaKind = z.infer<typeof MediaKind>;

/** Fields that may contain personal data. */
export const PiiField = z.enum([
  "message_caption",
  "message_text",
  "sender_first_name",
  "sender_last_name",
  "sender_language_code",
  "sender_username",
  "thread_title",
  "thread_username",
]);
export type PiiField = z.infer<typeof PiiField>;

/** Normalized chat thread. */
export const NormalizedThread = z.object({
  id: z.string(),
  kind: ThreadKind,
  title: z.string().optional(),
  username: z.string().optional(),
  pii_fields: z.array(PiiField).default([]),
});
export type NormalizedThread = z.infer<typeof NormalizedThread>;

/** Minimal sender metadata. */
export const SenderMetadata = z.object({
  id: z.string(),
  is_bot: z.boolean(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});
export type SenderMetadata = z.infer<typeof SenderMetadata>;

/** Ingress message content — discriminated union on `kind`. */
export const MessageContent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("media_placeholder"),
    media_kind: MediaKind,
    caption: z.string().optional(),
  }),
]);
export type MessageContent = z.infer<typeof MessageContent>;

/** Canonical chat message payload. */
export const NormalizedMessage = z.object({
  id: z.string(),
  thread_id: z.string(),
  source: MessageSource,
  content: MessageContent,
  sender: SenderMetadata.optional(),
  timestamp: z.string().datetime(),
  edited_timestamp: z.string().datetime().optional(),
  pii_fields: z.array(PiiField).default([]),
});
export type NormalizedMessage = z.infer<typeof NormalizedMessage>;

/** Bundles thread + message output. */
export const NormalizedThreadMessage = z.object({
  thread: NormalizedThread,
  message: NormalizedMessage,
});
export type NormalizedThreadMessage = z.infer<typeof NormalizedThreadMessage>;
