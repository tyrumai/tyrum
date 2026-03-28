import { z } from "zod";
import { ArtifactRef } from "./artifact.js";

/** Source channel for a normalized message. */
export const MessageSource = z.enum(["telegram"]);
export type MessageSource = z.infer<typeof MessageSource>;

/** Supported thread classifications. */
export const ThreadKind = z.enum(["private", "group", "supergroup", "channel", "other"]);
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

/** Baseline container classes used by conversation routing. */
export const NormalizedContainerKind = z.enum(["dm", "group", "channel"]);
export type NormalizedContainerKind = z.infer<typeof NormalizedContainerKind>;

export function normalizedContainerKindFromThreadKind(kind: ThreadKind): NormalizedContainerKind {
  switch (kind) {
    case "private":
      return "dm";
    case "channel":
      return "channel";
    default:
      return "group";
  }
}

/** Provenance tags preserved by connector normalization. */
export const MessageProvenance = z.enum(["user", "connector", "tool", "system"]);
export type MessageProvenance = z.infer<typeof MessageProvenance>;

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

/** Delivery identity for v2 normalized envelopes. */
export const NormalizedDeliveryIdentity = z
  .object({
    channel: z.string().trim().min(1),
    account: z.string().trim().min(1),
  })
  .strict();
export type NormalizedDeliveryIdentity = z.infer<typeof NormalizedDeliveryIdentity>;

/** Container reference for v2 normalized envelopes. */
export const NormalizedContainer = z
  .object({
    kind: NormalizedContainerKind,
    id: z.string().trim().min(1),
  })
  .strict();
export type NormalizedContainer = z.infer<typeof NormalizedContainer>;

/** Sender identity for v2 normalized envelopes. */
export const NormalizedEnvelopeSender = z
  .object({
    id: z.string().trim().min(1),
    display: z.string().trim().min(1).optional(),
  })
  .strict();
export type NormalizedEnvelopeSender = z.infer<typeof NormalizedEnvelopeSender>;

/** Attachment metadata preserved by normalization. */
export const NormalizedAttachment = ArtifactRef.extend({
  channel_kind: z.string().trim().min(1).optional(),
});
export type NormalizedAttachment = z.infer<typeof NormalizedAttachment>;

/** Canonical normalized message content. */
export const MessageContent = z
  .object({
    text: z.string().trim().min(1).optional(),
    attachments: z.array(NormalizedAttachment).default([]),
  })
  .strict()
  .refine((value) => typeof value.text === "string" || value.attachments.length > 0, {
    message: "content must include text or at least one attachment",
  });
export type MessageContent = z.infer<typeof MessageContent>;

/** Content payload for v2 normalized envelopes. */
export const NormalizedEnvelopeContent = MessageContent;
export type NormalizedEnvelopeContent = z.infer<typeof NormalizedEnvelopeContent>;

/** Baseline v2 normalized message envelope contract. */
export const NormalizedMessageEnvelope = z
  .object({
    message_id: z.string().trim().min(1),
    received_at: z.string().datetime(),
    delivery: NormalizedDeliveryIdentity,
    container: NormalizedContainer,
    sender: NormalizedEnvelopeSender,
    content: NormalizedEnvelopeContent,
    provenance: z.array(MessageProvenance).min(1),
  })
  .strict();
export type NormalizedMessageEnvelope = z.infer<typeof NormalizedMessageEnvelope>;

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
  envelope: NormalizedMessageEnvelope.optional(),
});
export type NormalizedMessage = z.infer<typeof NormalizedMessage>;

/** Bundles thread + message output. */
export const NormalizedThreadMessage = z.object({
  thread: NormalizedThread,
  message: NormalizedMessage,
});
export type NormalizedThreadMessage = z.infer<typeof NormalizedThreadMessage>;
