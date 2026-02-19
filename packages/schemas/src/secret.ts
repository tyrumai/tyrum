import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const SecretProviderKind = z.enum(["env", "file", "keychain"]);
export type SecretProviderKind = z.infer<typeof SecretProviderKind>;

export const SecretHandle = z
  .object({
    handle_id: z.string().min(1),
    provider: SecretProviderKind,
    scope: z.string().min(1),
    created_at: DateTimeSchema,
  })
  .strict();
export type SecretHandle = z.infer<typeof SecretHandle>;

export const SecretStoreRequest = z
  .object({
    scope: z.string().min(1),
    value: z.string().min(1),
    provider: SecretProviderKind.default("env"),
  })
  .strict();
export type SecretStoreRequest = z.infer<typeof SecretStoreRequest>;

export const SecretResolveRequest = z
  .object({
    handle_id: z.string().min(1),
  })
  .strict();
export type SecretResolveRequest = z.infer<typeof SecretResolveRequest>;

export const SecretResolveResponse = z
  .object({
    value: z.string(),
  })
  .strict();
export type SecretResolveResponse = z.infer<typeof SecretResolveResponse>;

export const SecretListResponse = z
  .object({
    handles: z.array(SecretHandle),
  })
  .strict();
export type SecretListResponse = z.infer<typeof SecretListResponse>;

export const SecretRevokeRequest = z
  .object({
    handle_id: z.string().min(1),
  })
  .strict();
export type SecretRevokeRequest = z.infer<typeof SecretRevokeRequest>;

export const SecretRevokeResponse = z
  .object({
    revoked: z.boolean(),
  })
  .strict();
export type SecretRevokeResponse = z.infer<typeof SecretRevokeResponse>;
