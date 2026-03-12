import type { OperatorCore } from "@tyrum/operator-core";

export type TelegramChannelConfig = {
  channel: "telegram";
  account_key: string;
  bot_token_configured: boolean;
  webhook_secret_configured: boolean;
  allowed_user_ids: string[];
  pipeline_enabled: boolean;
};

export type ChannelConfigListResult = {
  channels: TelegramChannelConfig[];
};

export type ChannelConfigCreateInput = {
  channel: "telegram";
  account_key: string;
  bot_token?: string;
  webhook_secret?: string;
  allowed_user_ids: string[];
  pipeline_enabled: boolean;
};

export type ChannelConfigUpdateInput = {
  bot_token?: string;
  clear_bot_token?: true;
  webhook_secret?: string;
  clear_webhook_secret?: true;
  allowed_user_ids: string[];
  pipeline_enabled: boolean;
};

export type ChannelConfigCreateResult = {
  config: TelegramChannelConfig;
};

export type ChannelConfigUpdateResult = {
  config: TelegramChannelConfig;
};

export type ChannelConfigDeleteResult = {
  deleted: boolean;
  channel: "telegram";
  account_key: string;
};

export type TelegramAccountRoutingConfig = {
  default_agent_key?: string;
  threads?: Record<string, string>;
};

export type ChannelRoutingConfig = {
  v: number;
  telegram?: {
    accounts?: Record<string, TelegramAccountRoutingConfig>;
    default_agent_key?: string;
    threads?: Record<string, string>;
  };
};

export type ChannelRoutingRevisionSummary = {
  revision: number;
  config: ChannelRoutingConfig;
  created_at: string;
  reason?: string;
  reverted_from_revision?: number;
};

export type ChannelRoutingApi = NonNullable<OperatorCore["http"]["routingConfig"]> & {
  listChannelConfigs: () => Promise<ChannelConfigListResult>;
  createChannelConfig: (input: ChannelConfigCreateInput) => Promise<ChannelConfigCreateResult>;
  updateChannelConfig: (
    channel: "telegram",
    accountKey: string,
    input: ChannelConfigUpdateInput,
  ) => Promise<ChannelConfigUpdateResult>;
  deleteChannelConfig: (
    channel: "telegram",
    accountKey: string,
  ) => Promise<ChannelConfigDeleteResult>;
};

export type ParsedUserIds = {
  ids: string[];
  invalid: string[];
};

export function asChannelRoutingApi(
  api: OperatorCore["http"]["routingConfig"] | null | undefined,
): ChannelRoutingApi | null {
  return (api ?? null) as ChannelRoutingApi | null;
}

export function isTelegramChannelConfig(config: {
  channel: string;
}): config is TelegramChannelConfig {
  return config.channel === "telegram";
}

export function getTelegramAccounts(
  config: ChannelRoutingConfig,
): Record<string, TelegramAccountRoutingConfig> {
  if (config.telegram?.accounts) {
    return config.telegram.accounts;
  }
  if (config.telegram?.default_agent_key || config.telegram?.threads) {
    return {
      default: {
        ...(config.telegram.default_agent_key
          ? { default_agent_key: config.telegram.default_agent_key }
          : {}),
        ...(config.telegram.threads ? { threads: config.telegram.threads } : {}),
      },
    };
  }
  return {};
}

export function parseAllowedUserIds(raw: string): ParsedUserIds {
  const seen = new Set<string>();
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (!/^[0-9]+$/.test(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return { ids, invalid };
}

export function formatAllowedUserIds(userIds: readonly string[]): string {
  return userIds.join("\n");
}

export function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sortChannelConfigs(configs: TelegramChannelConfig[]): TelegramChannelConfig[] {
  return [...configs].toSorted((left, right) => {
    const channelOrder = left.channel.localeCompare(right.channel);
    if (channelOrder !== 0) return channelOrder;
    return left.account_key.localeCompare(right.account_key);
  });
}

export function buildTelegramChannelCreateInput(input: {
  accountKey: string;
  botTokenRaw: string;
  webhookSecretRaw: string;
  allowedUserIds: string[];
  pipelineEnabled: boolean;
}): ChannelConfigCreateInput {
  const botToken = input.botTokenRaw.trim();
  const webhookSecret = input.webhookSecretRaw.trim();

  return {
    channel: "telegram",
    account_key: input.accountKey.trim(),
    ...(botToken ? { bot_token: botToken } : {}),
    ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    allowed_user_ids: input.allowedUserIds,
    pipeline_enabled: input.pipelineEnabled,
  };
}

export function buildTelegramChannelUpdateInput(input: {
  botTokenRaw: string;
  clearBotToken: boolean;
  webhookSecretRaw: string;
  clearWebhookSecret: boolean;
  allowedUserIds: string[];
  pipelineEnabled: boolean;
}): ChannelConfigUpdateInput {
  const botToken = input.botTokenRaw.trim();
  const webhookSecret = input.webhookSecretRaw.trim();

  return {
    ...(input.clearBotToken ? { clear_bot_token: true as const } : {}),
    ...(!input.clearBotToken && botToken ? { bot_token: botToken } : {}),
    ...(input.clearWebhookSecret ? { clear_webhook_secret: true as const } : {}),
    ...(!input.clearWebhookSecret && webhookSecret ? { webhook_secret: webhookSecret } : {}),
    allowed_user_ids: input.allowedUserIds,
    pipeline_enabled: input.pipelineEnabled,
  };
}

export function replaceConfig(
  configs: TelegramChannelConfig[],
  nextConfig: TelegramChannelConfig,
): TelegramChannelConfig[] {
  return sortChannelConfigs(
    configs.some((config) => config.account_key === nextConfig.account_key)
      ? configs.map((config) =>
          config.account_key === nextConfig.account_key ? nextConfig : config,
        )
      : [...configs, nextConfig],
  );
}

export function removeConfig(
  configs: TelegramChannelConfig[],
  accountKey: string,
): TelegramChannelConfig[] {
  return sortChannelConfigs(configs.filter((config) => config.account_key !== accountKey));
}
