import {
  ChannelRegistryField,
  ConfiguredChannelAccount,
  type ChannelFieldErrors,
  type ChannelRegistryEntry as ChannelRegistryEntryT,
  type ConfiguredChannelAccount as ConfiguredChannelAccountT,
} from "@tyrum/schemas";
import { z } from "zod";
import type { StoredChannelConfig } from "./channel-config-dal.js";
import { normalizeUniqueStringList } from "./channel-config-model.js";

export type CreateAccountInput = {
  accountKey: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type UpdateAccountInput<TConfig extends StoredChannelConfig> = {
  current: TConfig;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  clearSecretKeys: Set<string>;
};

export type ChannelRegistrySpec<TConfig extends StoredChannelConfig = StoredChannelConfig> = {
  entry: ChannelRegistryEntryT;
  create(input: CreateAccountInput): Promise<TConfig>;
  update(input: UpdateAccountInput<TConfig>): Promise<TConfig>;
  toConfiguredAccount(input: {
    config: TConfig;
    effectiveAgentKey?: string;
    createdAt: string;
    updatedAt: string;
  }): ConfiguredChannelAccountT;
};

type ChannelRegistryFieldInputValue = z.input<typeof ChannelRegistryField>;

export class ChannelValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: ChannelFieldErrors,
  ) {
    super(message);
    this.name = "ChannelValidationError";
  }
}

export function fieldError(fieldKey: string, message: string): ChannelValidationError {
  return new ChannelValidationError(message, { [fieldKey]: [message] });
}

export function field(input: ChannelRegistryFieldInputValue) {
  return ChannelRegistryField.parse(input);
}

export function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function unique(values: readonly string[]): string[] {
  return normalizeUniqueStringList(values);
}

export function readRequiredString(
  input: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw fieldError(key, `${label} is required`);
  }
  return value.trim();
}

export function readOptionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readEnumValue<TValue extends string>(
  input: Record<string, unknown>,
  key: string,
  label: string,
  allowed: readonly TValue[],
): TValue {
  const value = readRequiredString(input, key, label);
  if ((allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }
  throw fieldError(key, `${label} must be one of: ${allowed.join(", ")}`);
}

export function readBoolean(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

export function readRequiredSecret(
  input: Record<string, string>,
  key: string,
  label: string,
): string {
  const value = input[key];
  if (!value?.trim()) {
    throw fieldError(key, `${label} is required`);
  }
  return value.trim();
}

export function resolveSecretUpdate(params: {
  key: string;
  label: string;
  current?: string;
  secrets: Record<string, string>;
  clearSecretKeys: Set<string>;
  required?: boolean;
}): string | undefined {
  const next = params.secrets[params.key]?.trim();
  if (next) {
    return next;
  }
  if (params.clearSecretKeys.has(params.key)) {
    if (params.required) {
      throw fieldError(params.key, `${params.label} is required`);
    }
    return undefined;
  }
  if (params.current?.trim()) {
    return params.current;
  }
  if (params.required) {
    throw fieldError(params.key, `${params.label} is required`);
  }
  return undefined;
}

export function configuredSecretKeysForConfig(config: StoredChannelConfig): string[] {
  switch (config.channel) {
    case "telegram":
      return [
        ...(config.bot_token?.trim() ? ["bot_token"] : []),
        ...(config.webhook_secret?.trim() ? ["webhook_secret"] : []),
      ];
    case "discord":
      return config.bot_token?.trim() ? ["bot_token"] : [];
    case "googlechat":
      return config.service_account_json?.trim() ? ["service_account_json"] : [];
  }
}

export function toConfiguredChannelAccount(input: {
  channel: StoredChannelConfig["channel"];
  accountKey: string;
  config: Record<string, unknown>;
  configuredSecretKeys: string[];
  createdAt: string;
  updatedAt: string;
}): ConfiguredChannelAccountT {
  return ConfiguredChannelAccount.parse({
    channel: input.channel,
    account_key: input.accountKey,
    config: input.config,
    configured_secret_keys: input.configuredSecretKeys,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}
