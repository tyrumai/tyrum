import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { SecretHandle } from "./secret.js";

export const AuthProfileType = z.enum(["api_key", "oauth", "token"]);
export type AuthProfileType = z.infer<typeof AuthProfileType>;

export const AuthProfileBase = z
  .object({
    profile_id: z.string().trim().min(1),
    agent_id: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    type: AuthProfileType,
    secret_handles: z.record(z.string(), SecretHandle).default({}),
    expires_at: DateTimeSchema.optional(),
    labels: z.record(z.string(), z.string()).default({}),
    disabled_at: DateTimeSchema.optional(),
    disabled_reason: z.string().trim().min(1).optional(),
    cooldown_until: DateTimeSchema.optional(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type AuthProfileBase = z.infer<typeof AuthProfileBase>;

export const AuthProfile = z.discriminatedUnion("type", [
  AuthProfileBase.extend({
    type: z.literal("api_key"),
    secret_handles: z
      .object({
        api_key: SecretHandle,
      })
      .strict(),
  }),
  AuthProfileBase.extend({
    type: z.literal("token"),
    secret_handles: z
      .object({
        token: SecretHandle,
      })
      .strict(),
  }),
  AuthProfileBase.extend({
    type: z.literal("oauth"),
    oauth: z
      .object({
        token_url: z.string().trim().url(),
        client_id: z.string().trim().min(1),
      })
      .strict(),
    secret_handles: z
      .object({
        access_token: SecretHandle,
        refresh_token: SecretHandle,
        client_secret: SecretHandle.optional(),
      })
      .strict(),
  }),
]);
export type AuthProfile = z.infer<typeof AuthProfile>;

export const AuthProfileCreateRequest = z.discriminatedUnion("type", [
  z
    .object({
      agent_id: z.string().trim().min(1).default("default"),
      provider: z.string().trim().min(1),
      type: z.literal("api_key"),
      scope: z.string().trim().min(1),
      value: z.string().optional(),
      labels: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      agent_id: z.string().trim().min(1).default("default"),
      provider: z.string().trim().min(1),
      type: z.literal("token"),
      scope: z.string().trim().min(1),
      value: z.string().optional(),
      expires_at: DateTimeSchema.optional(),
      labels: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      agent_id: z.string().trim().min(1).default("default"),
      provider: z.string().trim().min(1),
      type: z.literal("oauth"),
      token_url: z.string().trim().url(),
      client_id: z.string().trim().min(1),
      // Optional: for providers that require a client secret (stored via secret handles).
      client_secret_scope: z.string().trim().min(1).optional(),
      client_secret_value: z.string().trim().min(1).optional(),
      access_token: z.string().trim().min(1),
      refresh_token: z.string().trim().min(1),
      expires_at: DateTimeSchema.optional(),
      labels: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);
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
