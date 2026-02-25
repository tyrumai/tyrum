import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId } from "./keys.js";

export const AuthProfileId = UuidSchema;
export type AuthProfileId = z.infer<typeof AuthProfileId>;

export const AuthProviderId = z.string().trim().min(1);
export type AuthProviderId = z.infer<typeof AuthProviderId>;

export const AuthProfileType = z.enum(["api_key", "oauth", "token"]);
export type AuthProfileType = z.infer<typeof AuthProfileType>;

export const AuthProfileStatus = z.enum(["active", "disabled"]);
export type AuthProfileStatus = z.infer<typeof AuthProfileStatus>;

export const AuthProfileSecretHandles = z.record(
  z.string().trim().min(1),
  z.string().trim().min(1),
);
export type AuthProfileSecretHandles = z.infer<typeof AuthProfileSecretHandles>;

export const AuthProfileLabels = z.record(z.string().trim().min(1), z.unknown());
export type AuthProfileLabels = z.infer<typeof AuthProfileLabels>;

export const AuthProfile = z
  .object({
    profile_id: AuthProfileId,
    agent_id: AgentId,
    provider: AuthProviderId,
    type: AuthProfileType,
    secret_handles: AuthProfileSecretHandles.default({}),
    labels: AuthProfileLabels.default({}),
    status: AuthProfileStatus,
    disabled_reason: z.string().trim().min(1).nullable().optional(),
    disabled_at: DateTimeSchema.nullable().optional(),
    cooldown_until_ms: z.number().int().nonnegative().nullable().optional(),
    expires_at: DateTimeSchema.nullable().optional(),
    created_by: z.unknown().optional(),
    updated_by: z.unknown().optional(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type AuthProfile = z.infer<typeof AuthProfile>;

export const AuthProfileCreateRequest = z
  .object({
    agent_id: AgentId.optional(),
    provider: AuthProviderId,
    type: AuthProfileType.default("api_key"),
    secret_handles: AuthProfileSecretHandles,
    labels: AuthProfileLabels.optional(),
    expires_at: DateTimeSchema.nullable().optional(),
    created_by: z.unknown().optional(),
  })
  .strict();
export type AuthProfileCreateRequest = z.infer<typeof AuthProfileCreateRequest>;

export const AuthProfileCreateResponse = z
  .object({
    profile: AuthProfile,
  })
  .strict();
export type AuthProfileCreateResponse = z.infer<typeof AuthProfileCreateResponse>;

export const AuthProfileListResponse = z
  .object({
    profiles: z.array(AuthProfile),
  })
  .strict();
export type AuthProfileListResponse = z.infer<typeof AuthProfileListResponse>;

export const AuthProfileUpdateRequest = z
  .object({
    labels: AuthProfileLabels.optional(),
    expires_at: DateTimeSchema.nullable().optional(),
    updated_by: z.unknown().optional(),
  })
  .strict();
export type AuthProfileUpdateRequest = z.infer<typeof AuthProfileUpdateRequest>;

export const AuthProfileDisableRequest = z
  .object({
    reason: z.string().trim().min(1).optional(),
    updated_by: z.unknown().optional(),
  })
  .strict();
export type AuthProfileDisableRequest = z.infer<typeof AuthProfileDisableRequest>;

export const AuthProfileEnableRequest = z
  .object({
    updated_by: z.unknown().optional(),
  })
  .strict();
export type AuthProfileEnableRequest = z.infer<typeof AuthProfileEnableRequest>;

export const SessionProviderPin = z
  .object({
    agent_id: AgentId,
    session_id: z.string().trim().min(1),
    provider: AuthProviderId,
    profile_id: AuthProfileId,
    pinned_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type SessionProviderPin = z.infer<typeof SessionProviderPin>;

export const SessionProviderPinListResponse = z
  .object({
    pins: z.array(SessionProviderPin),
  })
  .strict();
export type SessionProviderPinListResponse = z.infer<typeof SessionProviderPinListResponse>;

export const SessionProviderPinSetRequest = z
  .object({
    agent_id: AgentId.optional(),
    session_id: z.string().trim().min(1),
    provider: AuthProviderId,
    profile_id: AuthProfileId.nullable(),
    updated_by: z.unknown().optional(),
  })
  .strict();
export type SessionProviderPinSetRequest = z.infer<typeof SessionProviderPinSetRequest>;
