import { z } from "zod";

export const SlashCommandPayload = z
  .object({
    input: z.string().min(1),
  })
  .strict();
export type SlashCommandPayload = z.infer<typeof SlashCommandPayload>;

export const SlashCommandResult = z
  .object({
    output: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
export type SlashCommandResult = z.infer<typeof SlashCommandResult>;
