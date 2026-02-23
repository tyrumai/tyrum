import { z } from "zod";
import { DateTimeSchema } from "./common.js";

const Scope = z.string().trim().min(1);
const Role = z.enum(["client", "node"]);

export const MAX_DEVICE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()))];
}

export const DeviceTokenIssueRequest = z
  .object({
    device_id: z.string().trim().min(1),
    role: Role,
    scopes: z.array(Scope).default([]).transform(dedupeScopes),
    ttl_seconds: z.number().int().positive().max(MAX_DEVICE_TOKEN_TTL_SECONDS).optional(),
  })
  .strict();
export type DeviceTokenIssueRequest = z.infer<typeof DeviceTokenIssueRequest>;

export const DeviceTokenIssueResponse = z
  .object({
    token_kind: z.literal("device"),
    token: z.string().trim().min(1),
    token_id: z.string().trim().min(1),
    device_id: z.string().trim().min(1),
    role: Role,
    scopes: z.array(Scope).transform(dedupeScopes),
    issued_at: DateTimeSchema,
    expires_at: DateTimeSchema,
  })
  .strict();
export type DeviceTokenIssueResponse = z.infer<typeof DeviceTokenIssueResponse>;

export const DeviceTokenRevokeRequest = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict();
export type DeviceTokenRevokeRequest = z.infer<typeof DeviceTokenRevokeRequest>;

export const DeviceTokenRevokeResponse = z
  .object({
    revoked: z.boolean(),
    token_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeviceTokenRevokeResponse = z.infer<typeof DeviceTokenRevokeResponse>;

export const DeviceTokenClaims = z
  .object({
    token_kind: z.enum(["admin", "device"]),
    token_id: z.string().trim().min(1).optional(),
    device_id: z.string().trim().min(1).optional(),
    role: z.enum(["admin", "client", "node"]),
    scopes: z.array(Scope).transform(dedupeScopes),
    issued_at: DateTimeSchema.optional(),
    expires_at: DateTimeSchema.optional(),
  })
  .strict();
export type DeviceTokenClaims = z.infer<typeof DeviceTokenClaims>;
