import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { AccountId } from "./keys.js";
import { canonicalizeTelegramAllowedUserIds } from "./telegram.js";

const JsonRecord = z.record(z.string().trim().min(1), z.unknown());
const StringRecord = z.record(z.string().trim().min(1), z.string().trim().min(1));

export const ChannelType = z.enum(["telegram", "discord", "googlechat"]);
export type ChannelType = z.infer<typeof ChannelType>;

export const TelegramIngressMode = z.enum(["webhook", "polling"]);
export type TelegramIngressMode = z.infer<typeof TelegramIngressMode>;

export const TelegramPollingStatus = z.enum(["idle", "running", "error"]);
export type TelegramPollingStatus = z.infer<typeof TelegramPollingStatus>;

export const TelegramChannelConfigView = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    ingress_mode: TelegramIngressMode.default("webhook"),
    bot_token_configured: z.boolean(),
    webhook_secret_configured: z.boolean(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .default([])
      .overwrite(canonicalizeTelegramAllowedUserIds),
    pipeline_enabled: z.boolean().default(true),
    polling_status: TelegramPollingStatus.default("idle"),
    polling_last_error_at: DateTimeSchema.nullable().default(null),
    polling_last_error_message: z.string().trim().min(1).nullable().default(null),
  })
  .strict();
export type TelegramChannelConfigView = z.infer<typeof TelegramChannelConfigView>;

export const ChannelConfigView = z.discriminatedUnion("channel", [TelegramChannelConfigView]);
export type ChannelConfigView = z.infer<typeof ChannelConfigView>;

export const ChannelConfigListResponse = z
  .object({
    channels: z.array(ChannelConfigView),
  })
  .strict();
export type ChannelConfigListResponse = z.infer<typeof ChannelConfigListResponse>;

export const TelegramChannelConfigCreateRequest = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    ingress_mode: TelegramIngressMode.default("polling"),
    bot_token: z.string().trim().min(1).optional(),
    webhook_secret: z.string().trim().min(1).optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .overwrite(canonicalizeTelegramAllowedUserIds)
      .default([]),
    pipeline_enabled: z.boolean().default(true),
  })
  .strict();
export type TelegramChannelConfigCreateRequest = z.infer<typeof TelegramChannelConfigCreateRequest>;

export const ChannelConfigCreateRequest = z.discriminatedUnion("channel", [
  TelegramChannelConfigCreateRequest,
]);
export type ChannelConfigCreateRequest = z.infer<typeof ChannelConfigCreateRequest>;

export const TelegramChannelConfigUpdateRequest = z
  .object({
    ingress_mode: TelegramIngressMode.optional(),
    bot_token: z.string().trim().min(1).optional(),
    clear_bot_token: z.boolean().optional(),
    webhook_secret: z.string().trim().min(1).optional(),
    clear_webhook_secret: z.boolean().optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .overwrite(canonicalizeTelegramAllowedUserIds)
      .optional(),
    pipeline_enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.bot_token && value.clear_bot_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bot_token and clear_bot_token cannot be used together",
        path: ["clear_bot_token"],
      });
    }
    if (value.webhook_secret && value.clear_webhook_secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook_secret and clear_webhook_secret cannot be used together",
        path: ["clear_webhook_secret"],
      });
    }
  });
export type TelegramChannelConfigUpdateRequest = z.infer<typeof TelegramChannelConfigUpdateRequest>;

export const ChannelConfigUpdateResponse = z
  .object({
    config: ChannelConfigView,
  })
  .strict();
export type ChannelConfigUpdateResponse = z.infer<typeof ChannelConfigUpdateResponse>;

export const ChannelConfigCreateResponse = ChannelConfigUpdateResponse;
export type ChannelConfigCreateResponse = z.infer<typeof ChannelConfigCreateResponse>;

export const ChannelConfigDeleteResponse = z
  .object({
    deleted: z.boolean(),
    channel: ChannelType,
    account_key: AccountId,
  })
  .strict();
export type ChannelConfigDeleteResponse = z.infer<typeof ChannelConfigDeleteResponse>;

export const ChannelRegistryFieldKind = z.enum(["config", "secret"]);
export type ChannelRegistryFieldKind = z.infer<typeof ChannelRegistryFieldKind>;

export const ChannelRegistryFieldInput = z.enum([
  "text",
  "password",
  "textarea",
  "boolean",
  "select",
]);
export type ChannelRegistryFieldInput = z.infer<typeof ChannelRegistryFieldInput>;

export const ChannelRegistryFieldSection = z.enum([
  "credentials",
  "access",
  "delivery",
  "advanced",
]);
export type ChannelRegistryFieldSection = z.infer<typeof ChannelRegistryFieldSection>;

export const ChannelRegistryFieldOptionSource = z.enum(["agents"]);
export type ChannelRegistryFieldOptionSource = z.infer<typeof ChannelRegistryFieldOptionSource>;

export const ChannelRegistryFieldOption = z
  .object({
    value: z.string().trim().min(1),
    label: z.string().trim().min(1),
  })
  .strict();
export type ChannelRegistryFieldOption = z.infer<typeof ChannelRegistryFieldOption>;

export const ChannelRegistryFieldVisibility = z
  .object({
    field_key: z.string().trim().min(1),
    equals: z.union([z.string().trim().min(1), z.boolean()]),
  })
  .strict();
export type ChannelRegistryFieldVisibility = z.infer<typeof ChannelRegistryFieldVisibility>;

export const ChannelRegistryField = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().default(null),
    kind: ChannelRegistryFieldKind,
    input: ChannelRegistryFieldInput,
    section: ChannelRegistryFieldSection,
    required: z.boolean(),
    default_value: z
      .union([z.string().trim().min(1), z.boolean()])
      .nullable()
      .default(null),
    placeholder: z.string().trim().min(1).nullable().default(null),
    help_title: z.string().trim().min(1).nullable().default(null),
    help_lines: z.array(z.string().trim().min(1)).default([]),
    options: z.array(ChannelRegistryFieldOption).default([]),
    option_source: ChannelRegistryFieldOptionSource.nullable().default(null),
    visible_when: ChannelRegistryFieldVisibility.nullable().default(null),
  })
  .strict();
export type ChannelRegistryField = z.infer<typeof ChannelRegistryField>;

export const ChannelRegistryEntry = z
  .object({
    channel: ChannelType,
    name: z.string().trim().min(1),
    doc: z.string().trim().min(1).nullable().default(null),
    supported: z.boolean(),
    configurable: z.boolean(),
    intro_title: z.string().trim().min(1).nullable().default(null),
    intro_lines: z.array(z.string().trim().min(1)).default([]),
    fields: z.array(ChannelRegistryField),
  })
  .strict();
export type ChannelRegistryEntry = z.infer<typeof ChannelRegistryEntry>;

export const ChannelRegistryResponse = z
  .object({
    status: z.literal("ok"),
    channels: z.array(ChannelRegistryEntry),
  })
  .strict();
export type ChannelRegistryResponse = z.infer<typeof ChannelRegistryResponse>;

export const ConfiguredChannelAccount = z
  .object({
    channel: ChannelType,
    account_key: AccountId,
    config: JsonRecord.default({}),
    configured_secret_keys: z.array(z.string().trim().min(1)).default([]),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type ConfiguredChannelAccount = z.infer<typeof ConfiguredChannelAccount>;

export const ConfiguredChannelGroup = z
  .object({
    channel: ChannelType,
    name: z.string().trim().min(1),
    doc: z.string().trim().min(1).nullable().default(null),
    supported: z.boolean(),
    configurable: z.boolean(),
    accounts: z.array(ConfiguredChannelAccount),
  })
  .strict();
export type ConfiguredChannelGroup = z.infer<typeof ConfiguredChannelGroup>;

export const ConfiguredChannelListResponse = z
  .object({
    status: z.literal("ok"),
    channels: z.array(ConfiguredChannelGroup),
  })
  .strict();
export type ConfiguredChannelListResponse = z.infer<typeof ConfiguredChannelListResponse>;

export const ChannelAccountCreateRequest = z
  .object({
    channel: ChannelType,
    account_key: AccountId,
    config: JsonRecord.default({}),
    secrets: StringRecord.default({}),
  })
  .strict();
export type ChannelAccountCreateRequest = z.infer<typeof ChannelAccountCreateRequest>;

export const ChannelAccountUpdateRequest = z
  .object({
    config: JsonRecord.optional(),
    secrets: StringRecord.optional(),
    clear_secret_keys: z.array(z.string().trim().min(1)).default([]).optional(),
  })
  .strict();
export type ChannelAccountUpdateRequest = z.infer<typeof ChannelAccountUpdateRequest>;

export const ChannelAccountMutateResponse = z
  .object({
    status: z.literal("ok"),
    account: ConfiguredChannelAccount,
  })
  .strict();
export type ChannelAccountMutateResponse = z.infer<typeof ChannelAccountMutateResponse>;

export const ChannelAccountDeleteResponse = z
  .object({
    status: z.literal("ok"),
    deleted: z.boolean(),
    channel: ChannelType,
    account_key: AccountId,
  })
  .strict();
export type ChannelAccountDeleteResponse = z.infer<typeof ChannelAccountDeleteResponse>;

export const ChannelFieldErrors = z.record(
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)).min(1),
);
export type ChannelFieldErrors = z.infer<typeof ChannelFieldErrors>;

export const ChannelInvalidRequestResponse = z
  .object({
    error: z.literal("invalid_request"),
    message: z.string().trim().min(1),
    field_errors: ChannelFieldErrors.optional(),
  })
  .strict();
export type ChannelInvalidRequestResponse = z.infer<typeof ChannelInvalidRequestResponse>;
