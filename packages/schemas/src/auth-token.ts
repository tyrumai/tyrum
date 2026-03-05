import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

const Scope = z.string().trim().min(1);

export const AuthTokenRole = z.enum(["admin", "client", "node"]);
export type AuthTokenRole = z.infer<typeof AuthTokenRole>;

/**
 * Auth token claims resolved from the gateway database.
 *
 * Note: `token_kind` is kept for compatibility with legacy scope middleware semantics:
 * - admin tokens are treated as break-glass (not scope-limited)
 * - device tokens are scope-limited
 */
export const AuthTokenClaims = z
  .object({
    token_kind: z.enum(["admin", "device"]),
    token_id: z.string().trim().min(1),
    tenant_id: UuidSchema.nullable(),
    device_id: z.string().trim().min(1).optional(),
    role: AuthTokenRole,
    scopes: z.array(Scope),
    issued_at: DateTimeSchema.optional(),
    expires_at: DateTimeSchema.optional(),
  })
  .strict();
export type AuthTokenClaims = z.infer<typeof AuthTokenClaims>;

export const MAX_AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

export const AuthTokenIssueRequest = z
  .object({
    /**
     * When null, issues a system token (usable only on /system/* endpoints).
     * When set, issues a tenant-scoped token.
     */
    tenant_id: UuidSchema.nullable(),
    role: AuthTokenRole,
    scopes: z.array(Scope).default([]),
    /** Optional device binding (recommended for node/client tokens). */
    device_id: z.string().trim().min(1).optional(),
    ttl_seconds: z.number().int().positive().max(MAX_AUTH_TOKEN_TTL_SECONDS).optional(),
  })
  .strict();
export type AuthTokenIssueRequest = z.infer<typeof AuthTokenIssueRequest>;

export const AuthTokenIssueResponse = z
  .object({
    token: z.string().trim().min(1),
    token_id: z.string().trim().min(1),
    tenant_id: UuidSchema.nullable(),
    role: AuthTokenRole,
    device_id: z.string().trim().min(1).optional(),
    scopes: z.array(Scope),
    issued_at: DateTimeSchema,
    expires_at: DateTimeSchema.optional(),
  })
  .strict();
export type AuthTokenIssueResponse = z.infer<typeof AuthTokenIssueResponse>;

export const AuthTokenRevokeRequest = z
  .object({
    token_id: z.string().trim().min(1),
  })
  .strict();
export type AuthTokenRevokeRequest = z.infer<typeof AuthTokenRevokeRequest>;

export const AuthTokenRevokeResponse = z
  .object({
    revoked: z.boolean(),
    token_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type AuthTokenRevokeResponse = z.infer<typeof AuthTokenRevokeResponse>;
