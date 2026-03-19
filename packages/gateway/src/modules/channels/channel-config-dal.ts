import type { SqlDb } from "../../statestore/types.js";
import { secureStringEqual } from "../../utils/secure-string-equal.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";
import {
  StoredTelegramChannelConfigSchema,
  type StoredChannelConfig,
  type StoredTelegramChannelConfig,
  asStoredTelegramConfig,
  canonicalizeNumericIds,
  parseStoredChannelConfigOrThrow,
} from "./channel-config-model.js";

export { toChannelConfigView } from "./channel-config-model.js";
export type {
  StoredDiscordChannelConfig,
  StoredGoogleChatChannelConfig,
  StoredChannelConfig,
  StoredTelegramChannelConfig,
} from "./channel-config-model.js";

type RawChannelConfigRow = {
  tenant_id: string;
  connector_key: string;
  account_key: string;
  config_json: string;
  created_at?: string;
  updated_at?: string;
};

export type StoredChannelConfigEntry = {
  config: StoredChannelConfig;
  createdAt: string;
  updatedAt: string;
};

function normalizeIsoTimestamp(value: string | undefined): string {
  if (!value?.trim()) {
    return new Date().toISOString();
  }
  const normalized = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    .replace(/\s+([+-]\d{2}(?::?\d{2})?|[zZ])$/, "$1");
  const normalizedOffset = /[+-]\d{4}$/.test(normalized)
    ? `${normalized.slice(0, -2)}:${normalized.slice(-2)}`
    : /[+-]\d{2}$/.test(normalized)
      ? `${normalized}:00`
      : normalized;
  const withZone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(normalizedOffset)
    ? normalizedOffset
    : `${normalizedOffset}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function webhookSecretsEqual(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = left?.trim();
  const normalizedRight = right?.trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return secureStringEqual(normalizedLeft, normalizedRight);
}

export class ChannelConfigDal {
  constructor(private readonly db: SqlDb) {}

  async list(tenantId: string): Promise<StoredChannelConfig[]> {
    return await this.listRaw({ tenantId });
  }

  async listEntries(tenantId: string): Promise<StoredChannelConfigEntry[]> {
    return await this.listEntryRows({ tenantId });
  }

  async listTelegram(tenantId: string): Promise<StoredTelegramChannelConfig[]> {
    const rows = await this.listRaw({ tenantId, connectorKey: "telegram" });
    return rows.flatMap((config) => {
      const telegram = asStoredTelegramConfig(config);
      return telegram ? [telegram] : [];
    });
  }

  async getByChannelAndAccountKey(input: {
    tenantId: string;
    connectorKey: StoredChannelConfig["channel"];
    accountKey: string;
  }): Promise<StoredChannelConfig | undefined> {
    const entry = await this.getEntryByChannelAndAccountKey(input);
    return entry?.config;
  }

  async getEntryByChannelAndAccountKey(input: {
    tenantId: string;
    connectorKey: StoredChannelConfig["channel"];
    accountKey: string;
  }): Promise<StoredChannelConfigEntry | undefined> {
    const row = await this.db.get<RawChannelConfigRow>(
      `SELECT tenant_id, connector_key, account_key, config_json, created_at, updated_at
       FROM channel_configs
       WHERE tenant_id = ?
         AND connector_key = ?
         AND account_key = ?
       LIMIT 1`,
      [input.tenantId, input.connectorKey, input.accountKey],
    );
    return row
      ? {
          config: parseStoredChannelConfigOrThrow(row),
          createdAt: normalizeIsoTimestamp(row.created_at),
          updatedAt: normalizeIsoTimestamp(row.updated_at ?? row.created_at),
        }
      : undefined;
  }

  async getTelegramByAccountKey(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    const config = await this.getByChannelAndAccountKey({
      tenantId: input.tenantId,
      connectorKey: "telegram",
      accountKey: input.accountKey,
    });
    return config ? asStoredTelegramConfig(config) : undefined;
  }

  async getTelegramByWebhookSecret(input: {
    tenantId: string;
    webhookSecret: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    const secret = input.webhookSecret.trim();
    if (!secret) return undefined;
    const configs = await this.listTelegram(input.tenantId);
    let matched: StoredTelegramChannelConfig | undefined;
    for (const config of configs) {
      if (webhookSecretsEqual(config.webhook_secret, secret) && !matched) {
        matched = config;
      }
    }
    return matched;
  }

  async create(input: {
    tenantId: string;
    config: StoredChannelConfig;
  }): Promise<StoredChannelConfig> {
    if (input.config.channel === "telegram") {
      await this.assertUniqueTelegramWebhookSecret({
        tenantId: input.tenantId,
        webhookSecret: input.config.webhook_secret,
      });
    }

    let inserted;
    try {
      inserted = await this.db.run(
        `INSERT INTO channel_configs (
           tenant_id,
           connector_key,
           account_key,
           config_json
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, connector_key, account_key) DO NOTHING`,
        [
          input.tenantId,
          input.config.channel,
          input.config.account_key,
          JSON.stringify(input.config),
        ],
      );
    } catch (err) {
      if (
        input.config.channel === "telegram" &&
        input.config.webhook_secret &&
        isUniqueViolation(err)
      ) {
        throw await this.createTelegramWebhookSecretConflictError({
          tenantId: input.tenantId,
          webhookSecret: input.config.webhook_secret,
          accountKey: input.config.account_key,
        });
      }
      throw err;
    }

    if (inserted.changes !== 1) {
      throw new Error(
        `channel config ${input.config.channel}:${input.config.account_key} already exists`,
      );
    }
    return input.config;
  }

  async replace(input: {
    tenantId: string;
    config: StoredChannelConfig;
  }): Promise<StoredChannelConfig | undefined> {
    const existing = await this.getByChannelAndAccountKey({
      tenantId: input.tenantId,
      connectorKey: input.config.channel,
      accountKey: input.config.account_key,
    });
    if (!existing) return undefined;

    if (input.config.channel === "telegram") {
      await this.assertUniqueTelegramWebhookSecret({
        tenantId: input.tenantId,
        webhookSecret: input.config.webhook_secret,
        accountKey: input.config.account_key,
      });
    }

    try {
      await this.db.run(
        `UPDATE channel_configs
         SET config_json = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND connector_key = ?
           AND account_key = ?`,
        [
          JSON.stringify(input.config),
          new Date().toISOString(),
          input.tenantId,
          input.config.channel,
          input.config.account_key,
        ],
      );
    } catch (err) {
      if (
        input.config.channel === "telegram" &&
        input.config.webhook_secret &&
        isUniqueViolation(err)
      ) {
        throw await this.createTelegramWebhookSecretConflictError({
          tenantId: input.tenantId,
          webhookSecret: input.config.webhook_secret,
          accountKey: input.config.account_key,
        });
      }
      throw err;
    }

    return input.config;
  }

  async createTelegram(input: {
    tenantId: string;
    accountKey: string;
    agentKey?: string;
    ingressMode?: StoredTelegramChannelConfig["ingress_mode"];
    botToken?: string;
    webhookSecret?: string;
    allowedUserIds?: string[];
    pipelineEnabled?: boolean;
  }): Promise<StoredTelegramChannelConfig> {
    const config = StoredTelegramChannelConfigSchema.parse({
      channel: "telegram",
      account_key: input.accountKey,
      ...(input.agentKey?.trim() ? { agent_key: input.agentKey } : {}),
      ingress_mode: input.ingressMode ?? "polling",
      ...(input.botToken?.trim() ? { bot_token: input.botToken } : {}),
      ...(input.webhookSecret?.trim() ? { webhook_secret: input.webhookSecret } : {}),
      allowed_user_ids: canonicalizeNumericIds(input.allowedUserIds ?? []),
      pipeline_enabled: input.pipelineEnabled ?? true,
    });
    await this.create({ tenantId: input.tenantId, config });
    return config;
  }

  async updateTelegram(input: {
    tenantId: string;
    accountKey: string;
    agentKey?: string;
    clearAgentKey?: boolean;
    ingressMode?: StoredTelegramChannelConfig["ingress_mode"];
    botToken?: string;
    clearBotToken?: boolean;
    webhookSecret?: string;
    clearWebhookSecret?: boolean;
    allowedUserIds?: string[];
    pipelineEnabled?: boolean;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    const current = await this.getTelegramByAccountKey({
      tenantId: input.tenantId,
      accountKey: input.accountKey,
    });
    if (!current) return undefined;

    const nextAgentKey = input.clearAgentKey
      ? undefined
      : input.agentKey?.trim()
        ? input.agentKey
        : current.agent_key;
    const nextBotToken = input.clearBotToken
      ? undefined
      : input.botToken?.trim()
        ? input.botToken
        : current.bot_token;
    const nextWebhookSecret = input.clearWebhookSecret
      ? undefined
      : input.webhookSecret?.trim()
        ? input.webhookSecret
        : current.webhook_secret;

    const next = StoredTelegramChannelConfigSchema.parse({
      channel: "telegram",
      account_key: current.account_key,
      ...(nextAgentKey ? { agent_key: nextAgentKey } : {}),
      ingress_mode: input.ingressMode ?? current.ingress_mode,
      ...(nextBotToken ? { bot_token: nextBotToken } : {}),
      ...(nextWebhookSecret ? { webhook_secret: nextWebhookSecret } : {}),
      allowed_user_ids: canonicalizeNumericIds(input.allowedUserIds ?? current.allowed_user_ids),
      pipeline_enabled: input.pipelineEnabled ?? current.pipeline_enabled,
    });
    await this.replace({ tenantId: input.tenantId, config: next });
    return next;
  }

  async delete(input: {
    tenantId: string;
    connectorKey: string;
    accountKey: string;
  }): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM channel_configs
       WHERE tenant_id = ?
         AND connector_key = ?
         AND account_key = ?`,
      [input.tenantId, input.connectorKey, input.accountKey],
    );
    return result.changes === 1;
  }

  private async listRaw(input: {
    tenantId: string;
    connectorKey?: string;
  }): Promise<StoredChannelConfig[]> {
    const rows = await this.listEntryRows(input);
    return rows.map((row) => row.config);
  }

  private async listEntryRows(input: {
    tenantId: string;
    connectorKey?: string;
  }): Promise<StoredChannelConfigEntry[]> {
    const rows = await this.db.all<RawChannelConfigRow>(
      `SELECT tenant_id, connector_key, account_key, config_json, created_at, updated_at
       FROM channel_configs
       WHERE tenant_id = ?
         ${input.connectorKey ? "AND connector_key = ?" : ""}
       ORDER BY connector_key ASC, account_key ASC`,
      input.connectorKey ? [input.tenantId, input.connectorKey] : [input.tenantId],
    );
    return rows.map((row) => ({
      config: parseStoredChannelConfigOrThrow(row),
      createdAt: normalizeIsoTimestamp(row.created_at),
      updatedAt: normalizeIsoTimestamp(row.updated_at ?? row.created_at),
    }));
  }

  private async assertUniqueTelegramWebhookSecret(input: {
    tenantId: string;
    webhookSecret?: string;
    accountKey?: string;
  }): Promise<void> {
    const conflict = await this.findTelegramWebhookSecretConflict(input);
    if (conflict) {
      throw this.formatTelegramWebhookSecretConflictError(conflict.account_key);
    }
  }

  private async findTelegramWebhookSecretConflict(input: {
    tenantId: string;
    webhookSecret?: string;
    accountKey?: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    const secret = input.webhookSecret?.trim();
    if (!secret) return undefined;

    const configs = await this.listTelegram(input.tenantId);
    return configs.find(
      (config) =>
        config.account_key !== input.accountKey &&
        webhookSecretsEqual(config.webhook_secret, secret),
    );
  }

  private async createTelegramWebhookSecretConflictError(input: {
    tenantId: string;
    webhookSecret: string;
    accountKey?: string;
  }): Promise<Error> {
    const conflict = await this.findTelegramWebhookSecretConflict(input);
    return this.formatTelegramWebhookSecretConflictError(conflict?.account_key);
  }

  private formatTelegramWebhookSecretConflictError(accountKey?: string): Error {
    return new Error(
      accountKey
        ? `telegram webhook secret is already used by account '${accountKey}'`
        : "telegram webhook secret is already used by another account",
    );
  }
}
