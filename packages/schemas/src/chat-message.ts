import { z } from "zod";

export const ChatMessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type ChatMessageRole = z.infer<typeof ChatMessageRole>;

export const ChatMessagePart = z
  .object({
    type: z.string().trim().min(1),
  })
  .catchall(z.unknown());
export type ChatMessagePart = z.infer<typeof ChatMessagePart>;

export const ChatMessageMetadata = z.record(z.string(), z.unknown());
export type ChatMessageMetadata = z.infer<typeof ChatMessageMetadata>;

export const ChatMessage = z
  .object({
    id: z.string().trim().min(1),
    role: ChatMessageRole,
    parts: z.array(ChatMessagePart),
    metadata: ChatMessageMetadata.optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatMessagePreview = z
  .object({
    role: ChatMessageRole,
    content: z.string(),
  })
  .strict();
export type ChatMessagePreview = z.infer<typeof ChatMessagePreview>;
