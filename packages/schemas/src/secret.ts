import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const SecretProviderKind = z.enum(["env", "file", "keychain"]);
export type SecretProviderKind = z.infer<typeof SecretProviderKind>;

export const SecretHandle = z
  .object({
    handle_id: z.string().min(1),
    provider: SecretProviderKind,
    scope: z.string().trim().min(1),
    created_at: DateTimeSchema,
  })
  .strict();
export type SecretHandle = z.infer<typeof SecretHandle>;

export const SecretStoreRequest = z
  .object({
    scope: z.string().trim().min(1),
    value: z.string().optional(),
    provider: SecretProviderKind.default("env"),
  })
  .strict();
export type SecretStoreRequest = z.infer<typeof SecretStoreRequest>;

export const SecretRotateRequest = z
  .object({
    value: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, { message: "value is required" }),
  })
  .strict();
export type SecretRotateRequest = z.infer<typeof SecretRotateRequest>;

export const SecretRotateResponse = z
  .object({
    revoked: z.boolean(),
    handle: SecretHandle,
  })
  .strict();
export type SecretRotateResponse = z.infer<typeof SecretRotateResponse>;

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
