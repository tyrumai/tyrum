import { z } from "zod";

export const SecretHandle = z.object({
  handle_id: z.string().min(1),
  provider: z.enum(["env", "file"]),
  scope: z.string().min(1),
  created_at: z.string(),
});
export type SecretHandle = z.infer<typeof SecretHandle>;

export const SecretStoreRequest = z.object({
  scope: z.string().min(1),
  value: z.string().min(1),
  provider: z.enum(["env", "file"]).default("env"),
});
export type SecretStoreRequest = z.infer<typeof SecretStoreRequest>;
