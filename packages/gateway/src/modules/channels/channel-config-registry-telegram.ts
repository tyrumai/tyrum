import { ChannelRegistryEntry } from "@tyrum/contracts";
import type { StoredTelegramChannelConfig } from "./channel-config-dal.js";
import {
  type ChannelRegistrySpec,
  configuredSecretKeysForConfig,
  field,
  fieldError,
  parseStringList,
  readBoolean,
  readRequiredSecret,
  readRequiredString,
  resolveSecretUpdate,
  toConfiguredChannelAccount,
  unique,
} from "./channel-config-registry-shared.js";

const TELEGRAM_TOKEN_HELP_LINES = [
  "1. Open Telegram and chat with @BotFather.",
  "2. Run /newbot (or /mybots).",
  "3. Copy the bot token. It looks like 123456:ABC...",
];

const TELEGRAM_USER_ID_HELP_LINES = [
  "Add yourself to the allowlist first.",
  "Message your bot, then inspect Telegram getUpdates or your webhook payload and read message.from.id.",
  "You can also enter @username and Tyrum will resolve it when a bot token is present.",
];

async function fetchTelegramChatId(params: {
  token: string;
  chatId: string;
}): Promise<string | null> {
  const url = `https://api.telegram.org/bot${params.token}/getChat?chat_id=${encodeURIComponent(params.chatId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { id?: number | string };
    } | null;
    const id = data?.ok ? data.result?.id : undefined;
    return typeof id === "number" || typeof id === "string" ? String(id) : null;
  } catch {
    return null;
  }
}

async function resolveTelegramAllowedUsers(input: {
  entries: string[];
  token?: string;
  fieldKey: string;
}): Promise<string[]> {
  const resolved: string[] = [];
  for (const entry of input.entries) {
    const normalized = entry.replace(/^(telegram|tg):/i, "").trim();
    if (/^[0-9]+$/.test(normalized)) {
      resolved.push(normalized);
      continue;
    }
    if (!input.token) {
      throw fieldError(input.fieldKey, "Telegram usernames require a bot token to resolve");
    }
    const username = normalized.startsWith("@") ? normalized : `@${normalized}`;
    const id = await fetchTelegramChatId({ token: input.token, chatId: username });
    if (!id) {
      throw fieldError(input.fieldKey, `Unable to resolve Telegram user '${entry}'`);
    }
    resolved.push(id);
  }
  return unique(resolved);
}

export const telegramSpec: ChannelRegistrySpec<StoredTelegramChannelConfig> = {
  entry: ChannelRegistryEntry.parse({
    channel: "telegram",
    name: "Telegram",
    doc: null,
    supported: true,
    configurable: true,
    intro_title: "Telegram setup",
    intro_lines: [
      "Telegram accounts need a bot token, a webhook secret, and a target agent.",
      "Usernames can be resolved to numeric sender IDs when a bot token is present.",
    ],
    fields: [
      field({
        key: "bot_token",
        label: "Bot token",
        description: "Required for Telegram ingress and username resolution.",
        kind: "secret",
        input: "password",
        section: "credentials",
        required: true,
        help_title: "How to get a bot token",
        help_lines: TELEGRAM_TOKEN_HELP_LINES,
      }),
      field({
        key: "webhook_secret",
        label: "Webhook secret",
        description: "Required for Telegram webhook validation.",
        kind: "secret",
        input: "password",
        section: "credentials",
        required: true,
      }),
      field({
        key: "allowed_user_ids",
        label: "Allowed Telegram users",
        description: "Numeric sender IDs are stored. @username entries are resolved on save.",
        kind: "config",
        input: "textarea",
        section: "access",
        required: false,
        placeholder: "@username, 123456789",
        help_title: "How to find your Telegram user ID",
        help_lines: TELEGRAM_USER_ID_HELP_LINES,
      }),
      field({
        key: "agent_key",
        label: "Target agent",
        description: "All Telegram messages for this account will go to this agent.",
        kind: "config",
        input: "select",
        section: "delivery",
        required: true,
        option_source: "agents",
      }),
      field({
        key: "pipeline_enabled",
        label: "Enable channel pipeline",
        description: "Turn off to stop using the Telegram queue for this account immediately.",
        kind: "config",
        input: "boolean",
        section: "advanced",
        required: false,
        default_value: true,
      }),
    ],
  }),
  async create(input) {
    const botToken = readRequiredSecret(input.secrets, "bot_token", "Bot token");
    const webhookSecret = readRequiredSecret(input.secrets, "webhook_secret", "Webhook secret");
    return {
      channel: "telegram",
      account_key: input.accountKey,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      bot_token: botToken,
      webhook_secret: webhookSecret,
      allowed_user_ids: await resolveTelegramAllowedUsers({
        entries: parseStringList(input.config["allowed_user_ids"]),
        token: botToken,
        fieldKey: "allowed_user_ids",
      }),
      pipeline_enabled: readBoolean(input.config, "pipeline_enabled", true),
    };
  },
  async update(input) {
    const botToken = resolveSecretUpdate({
      key: "bot_token",
      label: "Bot token",
      current: input.current.bot_token,
      secrets: input.secrets,
      clearSecretKeys: input.clearSecretKeys,
      required: true,
    });
    const hasAllowedUserIds = Object.prototype.hasOwnProperty.call(
      input.config,
      "allowed_user_ids",
    );
    return {
      channel: "telegram",
      account_key: input.current.account_key,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      ...(botToken ? { bot_token: botToken } : {}),
      ...(() => {
        const webhookSecret = resolveSecretUpdate({
          key: "webhook_secret",
          label: "Webhook secret",
          current: input.current.webhook_secret,
          secrets: input.secrets,
          clearSecretKeys: input.clearSecretKeys,
          required: true,
        });
        return webhookSecret ? { webhook_secret: webhookSecret } : {};
      })(),
      allowed_user_ids: hasAllowedUserIds
        ? await resolveTelegramAllowedUsers({
            entries: parseStringList(input.config["allowed_user_ids"]),
            token: botToken,
            fieldKey: "allowed_user_ids",
          })
        : input.current.allowed_user_ids,
      pipeline_enabled: readBoolean(
        input.config,
        "pipeline_enabled",
        input.current.pipeline_enabled,
      ),
    };
  },
  toConfiguredAccount(input) {
    return toConfiguredChannelAccount({
      channel: "telegram",
      accountKey: input.config.account_key,
      config: {
        agent_key: input.effectiveAgentKey ?? input.config.agent_key ?? "default",
        allowed_user_ids: input.config.allowed_user_ids,
        pipeline_enabled: input.config.pipeline_enabled,
      },
      configuredSecretKeys: configuredSecretKeysForConfig(input.config),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  },
};
