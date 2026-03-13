import { z } from "zod";

export const TyrumUIMessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type TyrumUIMessageRole = z.infer<typeof TyrumUIMessageRole>;

export const TyrumUIMessagePart = z
  .object({
    type: z.string().trim().min(1),
  })
  .catchall(z.unknown());
export type TyrumUIMessagePart = z.infer<typeof TyrumUIMessagePart>;

export const TyrumUIMessageMetadata = z.record(z.string(), z.unknown());
export type TyrumUIMessageMetadata = z.infer<typeof TyrumUIMessageMetadata>;

export const TyrumUIMessage = z
  .object({
    id: z.string().trim().min(1),
    role: TyrumUIMessageRole,
    parts: z.array(TyrumUIMessagePart),
    metadata: TyrumUIMessageMetadata.optional(),
  })
  .strict();
export type TyrumUIMessage = z.infer<typeof TyrumUIMessage>;

export const TyrumUIMessagePreview = z
  .object({
    role: TyrumUIMessageRole,
    content: z.string(),
  })
  .strict();
export type TyrumUIMessagePreview = z.infer<typeof TyrumUIMessagePreview>;
