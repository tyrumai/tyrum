import {
  AccountId,
  AgentKey,
  ChannelConfigView as ChannelConfigViewSchema,
  TelegramIngressMode,
  type ChannelConfigView as ChannelConfigViewT,
} from "@tyrum/contracts";
import { z } from "zod";
import { safeJsonParse } from "../../utils/json.js";

export function normalizeUniqueStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function canonicalizeNumericIds(values: readonly string[]): string[] {
  return normalizeUniqueStringList(values);
}

const DiscordAllowedChannel = z
  .string()
  .trim()
  .regex(/^guild:[^/\s]+(?:\/channel:[^/\s]+)?$/i);

export const GoogleChatAuthMethod = z.enum(["inline_json", "file_path"]);
export type GoogleChatAuthMethod = z.infer<typeof GoogleChatAuthMethod>;

export const GoogleChatAudienceType = z.enum(["app-url", "project-number"]);
export type GoogleChatAudienceType = z.infer<typeof GoogleChatAudienceType>;

export const StoredTelegramChannelConfigSchema = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    agent_key: AgentKey.optional(),
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
      .default([])
      .transform(canonicalizeNumericIds),
    pipeline_enabled: z.boolean().default(true),
  })
  .strict();
export type StoredTelegramChannelConfig = z.infer<typeof StoredTelegramChannelConfigSchema>;

export type TelegramPollingStatusView = {
  status: "idle" | "running" | "error";
  lastErrorAt?: string;
  lastErrorMessage?: string;
};

export const StoredDiscordChannelConfigSchema = z
  .object({
    channel: z.literal("discord"),
    account_key: AccountId,
    agent_key: AgentKey,
    bot_token: z.string().trim().min(1).optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .default([])
      .transform(canonicalizeNumericIds),
    allowed_channels: z
      .array(DiscordAllowedChannel)
      .default([])
      .transform(normalizeUniqueStringList),
  })
  .strict();
export type StoredDiscordChannelConfig = z.infer<typeof StoredDiscordChannelConfigSchema>;

export const StoredGoogleChatChannelConfigSchema = z
  .object({
    channel: z.literal("googlechat"),
    account_key: AccountId,
    agent_key: AgentKey,
    auth_method: GoogleChatAuthMethod,
    service_account_json: z.string().trim().min(1).optional(),
    service_account_file: z.string().trim().min(1).optional(),
    audience_type: GoogleChatAudienceType,
    audience: z.string().trim().min(1),
    allowed_users: z
      .array(z.string().trim().min(1))
      .default([])
      .transform(normalizeUniqueStringList),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.auth_method === "inline_json" && !value.service_account_json) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service_account_json is required when auth_method is inline_json",
        path: ["service_account_json"],
      });
    }
    if (value.auth_method === "file_path" && !value.service_account_file) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service_account_file is required when auth_method is file_path",
        path: ["service_account_file"],
      });
    }
  });
export type StoredGoogleChatChannelConfig = z.infer<typeof StoredGoogleChatChannelConfigSchema>;

export const StoredChannelConfigSchema = z.discriminatedUnion("channel", [
  StoredTelegramChannelConfigSchema,
  StoredDiscordChannelConfigSchema,
  StoredGoogleChatChannelConfigSchema,
]);
export type StoredChannelConfig = z.infer<typeof StoredChannelConfigSchema>;

type ChannelConfigRowShape = {
  connector_key: string;
  account_key: string;
  config_json: string;
};

export function parseStoredChannelConfigOrThrow(row: ChannelConfigRowShape): StoredChannelConfig {
  const parsed = safeJsonParse(row.config_json, null);
  const config = StoredChannelConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw new Error(
      `channel config ${row.connector_key}:${row.account_key} failed schema validation: ${config.error.message}`,
    );
  }
  return config.data;
}

export function asStoredTelegramConfig(
  config: StoredChannelConfig,
): StoredTelegramChannelConfig | undefined {
  return config.channel === "telegram" ? config : undefined;
}

export function toChannelConfigView(
  config: StoredTelegramChannelConfig,
  polling?: TelegramPollingStatusView,
): ChannelConfigViewT {
  return ChannelConfigViewSchema.parse({
    channel: config.channel,
    account_key: config.account_key,
    ingress_mode: config.ingress_mode,
    bot_token_configured: Boolean(config.bot_token?.trim()),
    webhook_secret_configured: Boolean(config.webhook_secret?.trim()),
    allowed_user_ids: config.allowed_user_ids,
    pipeline_enabled: config.pipeline_enabled,
    polling_status: polling?.status ?? "idle",
    polling_last_error_at: polling?.lastErrorAt ?? null,
    polling_last_error_message: polling?.lastErrorMessage ?? null,
  });
}
