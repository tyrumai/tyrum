import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

export const AuthProfileId = UuidSchema;
export type AuthProfileId = z.infer<typeof AuthProfileId>;

export const AuthProfileKey = z.string().trim().min(1);
export type AuthProfileKey = z.infer<typeof AuthProfileKey>;

export const AuthProviderId = z.string().trim().min(1);
export type AuthProviderId = z.infer<typeof AuthProviderId>;

export const AuthProfileType = z.enum(["api_key", "oauth", "token"]);
export type AuthProfileType = z.infer<typeof AuthProfileType>;

export const AuthProfileStatus = z.enum(["active", "disabled"]);
export type AuthProfileStatus = z.infer<typeof AuthProfileStatus>;

export const AuthProfileSecretKeys = z.record(z.string().trim().min(1), z.string().trim().min(1));
export type AuthProfileSecretKeys = z.infer<typeof AuthProfileSecretKeys>;

export const AuthProfileLabels = z.record(z.string().trim().min(1), z.unknown());
export type AuthProfileLabels = z.infer<typeof AuthProfileLabels>;

export const AuthProfile = z
  .object({
    auth_profile_id: AuthProfileId,
    auth_profile_key: AuthProfileKey,
    provider_key: AuthProviderId,
    type: AuthProfileType,
    secret_keys: AuthProfileSecretKeys.default({}),
    labels: AuthProfileLabels.default({}),
    status: AuthProfileStatus,
    created_by: z.unknown().optional(),
    updated_by: z.unknown().optional(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type AuthProfile = z.infer<typeof AuthProfile>;

export const AuthProfileCreateRequest = z
  .object({
    auth_profile_key: AuthProfileKey,
    provider_key: AuthProviderId,
    type: AuthProfileType.default("api_key"),
    secret_keys: AuthProfileSecretKeys.default({}),
    labels: AuthProfileLabels.optional(),
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
    secret_keys: AuthProfileSecretKeys.optional(),
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

export const ConversationProviderPin = z
  .object({
    conversation_id: UuidSchema,
    provider_key: AuthProviderId,
    auth_profile_id: AuthProfileId,
    auth_profile_key: AuthProfileKey,
    pinned_at: DateTimeSchema,
  })
  .strict();
export type ConversationProviderPin = z.infer<typeof ConversationProviderPin>;

export const ConversationProviderPinListResponse = z
  .object({
    pins: z.array(ConversationProviderPin),
  })
  .strict();
export type ConversationProviderPinListResponse = z.infer<
  typeof ConversationProviderPinListResponse
>;

export const ConversationProviderPinSetRequest = z
  .object({
    conversation_id: UuidSchema,
    provider_key: AuthProviderId,
    auth_profile_key: AuthProfileKey.nullable(),
    updated_by: z.unknown().optional(),
  })
  .strict();
export type ConversationProviderPinSetRequest = z.infer<typeof ConversationProviderPinSetRequest>;

export const ConversationProviderPinSetResponse = z
  .object({
    status: z.literal("ok"),
    pin: ConversationProviderPin,
  })
  .strict();
export type ConversationProviderPinSetResponse = z.infer<typeof ConversationProviderPinSetResponse>;

export const ConversationProviderPinClearResponse = z
  .object({
    status: z.literal("ok"),
    cleared: z.boolean(),
  })
  .strict();
export type ConversationProviderPinClearResponse = z.infer<
  typeof ConversationProviderPinClearResponse
>;
