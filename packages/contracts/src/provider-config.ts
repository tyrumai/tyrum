import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AuthProfileStatus, AuthProfileType } from "./auth-profile.js";

const JsonRecord = z.record(z.string().trim().min(1), z.unknown());
const StringRecord = z.record(z.string().trim().min(1), z.string().trim().min(1));

export const ProviderConfigFieldKind = z.enum(["config", "secret"]);
export type ProviderConfigFieldKind = z.infer<typeof ProviderConfigFieldKind>;

export const ProviderConfigFieldInput = z.enum(["text", "password", "boolean"]);
export type ProviderConfigFieldInput = z.infer<typeof ProviderConfigFieldInput>;

export const ProviderConfigField = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().default(null),
    kind: ProviderConfigFieldKind,
    input: ProviderConfigFieldInput,
    required: z.boolean(),
  })
  .strict();
export type ProviderConfigField = z.infer<typeof ProviderConfigField>;

export const ProviderAccountMethod = z
  .object({
    method_key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: AuthProfileType,
    fields: z.array(ProviderConfigField),
  })
  .strict();
export type ProviderAccountMethod = z.infer<typeof ProviderAccountMethod>;

export const ProviderRegistryEntry = z
  .object({
    provider_key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    doc: z.string().trim().min(1).nullable().default(null),
    supported: z.boolean(),
    methods: z.array(ProviderAccountMethod),
  })
  .strict();
export type ProviderRegistryEntry = z.infer<typeof ProviderRegistryEntry>;

export const ProviderRegistryResponse = z
  .object({
    status: z.literal("ok"),
    providers: z.array(ProviderRegistryEntry),
  })
  .strict();
export type ProviderRegistryResponse = z.infer<typeof ProviderRegistryResponse>;

export const ConfiguredProviderAccount = z
  .object({
    account_id: UuidSchema,
    account_key: z.string().trim().min(1),
    provider_key: z.string().trim().min(1),
    display_name: z.string().trim().min(1),
    method_key: z.string().trim().min(1),
    type: AuthProfileType,
    status: AuthProfileStatus,
    config: JsonRecord.default({}),
    configured_secret_keys: z.array(z.string().trim().min(1)).default([]),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type ConfiguredProviderAccount = z.infer<typeof ConfiguredProviderAccount>;

export const ConfiguredProviderGroup = z
  .object({
    provider_key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    doc: z.string().trim().min(1).nullable().default(null),
    supported: z.boolean(),
    accounts: z.array(ConfiguredProviderAccount),
  })
  .strict();
export type ConfiguredProviderGroup = z.infer<typeof ConfiguredProviderGroup>;

export const ConfiguredProviderListResponse = z
  .object({
    status: z.literal("ok"),
    providers: z.array(ConfiguredProviderGroup),
  })
  .strict();
export type ConfiguredProviderListResponse = z.infer<typeof ConfiguredProviderListResponse>;

export const ProviderAccountCreateRequest = z
  .object({
    provider_key: z.string().trim().min(1),
    display_name: z.string().trim().min(1),
    method_key: z.string().trim().min(1),
    config: JsonRecord.default({}),
    secrets: StringRecord.default({}),
  })
  .strict();
export type ProviderAccountCreateRequest = z.infer<typeof ProviderAccountCreateRequest>;

export const ProviderAccountUpdateRequest = z
  .object({
    display_name: z.string().trim().min(1).optional(),
    status: AuthProfileStatus.optional(),
    config: JsonRecord.optional(),
    secrets: StringRecord.optional(),
  })
  .strict();
export type ProviderAccountUpdateRequest = z.infer<typeof ProviderAccountUpdateRequest>;

export const ProviderAccountMutateResponse = z
  .object({
    status: z.literal("ok"),
    account: ConfiguredProviderAccount,
  })
  .strict();
export type ProviderAccountMutateResponse = z.infer<typeof ProviderAccountMutateResponse>;
