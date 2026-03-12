import {
  ChannelConfigView as ChannelConfigViewSchema,
  type ChannelConfigView as ChannelConfigViewT,
} from "@tyrum/schemas";
import { AccountId } from "@tyrum/schemas";
import { z } from "zod";
import type { SqlDb } from "../../statestore/types.js";
import { DeploymentConfigDal } from "../config/deployment-config-dal.js";
import { safeJsonParse } from "../../utils/json.js";
import { secureStringEqual } from "../../utils/secure-string-equal.js";

function canonicalizeTelegramAllowedUserIds(userIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const userId of userIds) {
    const trimmed = userId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

const StoredTelegramChannelConfig = z
  .object({
    channel: z.literal("telegram"),
    account_key: AccountId,
    bot_token: z.string().trim().min(1).optional(),
    webhook_secret: z.string().trim().min(1).optional(),
    allowed_user_ids: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      )
      .default([]),
    pipeline_enabled: z.boolean().default(true),
  })
  .strict();
export type StoredTelegramChannelConfig = z.infer<typeof StoredTelegramChannelConfig>;

const StoredChannelConfig = z.discriminatedUnion("channel", [StoredTelegramChannelConfig]);
type StoredChannelConfig = z.infer<typeof StoredChannelConfig>;

// Hidden sentinel row so a tenant that deleted every live channel config does not
// re-import the legacy singleton deployment config on the next read.
const LEGACY_IMPORT_MARKER_CONNECTOR_KEY = "__legacy_import__";
const LEGACY_IMPORT_MARKER_ACCOUNT_KEY = "telegram";

type RawChannelConfigRow = {
  tenant_id: string;
  connector_key: string;
  account_key: string;
  config_json: string;
};

function parseStoredChannelConfigOrThrow(row: RawChannelConfigRow): StoredChannelConfig {
  const parsed = safeJsonParse(row.config_json, null);
  const config = StoredChannelConfig.safeParse(parsed);
  if (!config.success) {
    throw new Error(
      `channel config ${row.connector_key}:${row.account_key} failed schema validation: ${config.error.message}`,
    );
  }
  return config.data;
}

export function toChannelConfigView(config: StoredChannelConfig): ChannelConfigViewT {
  return ChannelConfigViewSchema.parse({
    channel: config.channel,
    account_key: config.account_key,
    bot_token_configured: Boolean(config.bot_token?.trim()),
    webhook_secret_configured: Boolean(config.webhook_secret?.trim()),
    allowed_user_ids: config.allowed_user_ids,
    pipeline_enabled: config.pipeline_enabled,
  });
}

function webhookSecretsEqual(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = left?.trim();
  const normalizedRight = right?.trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return secureStringEqual(normalizedLeft, normalizedRight);
}

function hasLegacyTelegramConfig(config: {
  channels?: {
    telegramBotToken?: string;
    telegramWebhookSecret?: string;
    telegramAllowedUserIds?: string[];
    pipelineEnabled?: boolean;
  };
}): boolean {
  const channels = config.channels;
  return Boolean(
    channels?.telegramBotToken?.trim() ||
    channels?.telegramWebhookSecret?.trim() ||
    (channels?.telegramAllowedUserIds?.length ?? 0) > 0 ||
    channels?.pipelineEnabled === false,
  );
}

export class ChannelConfigDal {
  private readonly deploymentConfigDal: DeploymentConfigDal;

  constructor(private readonly db: SqlDb) {
    this.deploymentConfigDal = new DeploymentConfigDal(db);
  }

  async list(tenantId: string): Promise<StoredChannelConfig[]> {
    await this.ensureLegacyImported(tenantId);
    return await this.listRaw({ tenantId });
  }

  async listTelegram(tenantId: string): Promise<StoredTelegramChannelConfig[]> {
    await this.ensureLegacyImported(tenantId);
    const rows = await this.listRaw({ tenantId, connectorKey: "telegram" });
    return rows.filter(
      (config): config is StoredTelegramChannelConfig => config.channel === "telegram",
    );
  }

  async getTelegramByAccountKey(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    await this.ensureLegacyImported(input.tenantId);
    const row = await this.db.get<RawChannelConfigRow>(
      `SELECT tenant_id, connector_key, account_key, config_json
       FROM channel_configs
       WHERE tenant_id = ?
         AND connector_key = 'telegram'
         AND account_key = ?
       LIMIT 1`,
      [input.tenantId, input.accountKey],
    );
    if (!row) return undefined;
    const config = parseStoredChannelConfigOrThrow(row);
    return config.channel === "telegram" ? config : undefined;
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
      if (webhookSecretsEqual(config.webhook_secret, secret)) {
        matched = config;
      }
    }
    return matched;
  }

  async createTelegram(input: {
    tenantId: string;
    accountKey: string;
    botToken?: string;
    webhookSecret?: string;
    allowedUserIds?: string[];
    pipelineEnabled?: boolean;
  }): Promise<StoredTelegramChannelConfig> {
    await this.ensureLegacyImported(input.tenantId);
    const config = StoredTelegramChannelConfig.parse({
      channel: "telegram",
      account_key: input.accountKey,
      ...(input.botToken?.trim() ? { bot_token: input.botToken } : {}),
      ...(input.webhookSecret?.trim() ? { webhook_secret: input.webhookSecret } : {}),
      allowed_user_ids: canonicalizeTelegramAllowedUserIds(input.allowedUserIds ?? []),
      pipeline_enabled: input.pipelineEnabled ?? true,
    });
    await this.assertUniqueTelegramWebhookSecret({
      tenantId: input.tenantId,
      webhookSecret: config.webhook_secret,
      accountKey: undefined,
    });

    const inserted = await this.db.run(
      `INSERT INTO channel_configs (
         tenant_id,
         connector_key,
         account_key,
         config_json
       )
       VALUES (?, 'telegram', ?, ?)
       ON CONFLICT (tenant_id, connector_key, account_key) DO NOTHING`,
      [input.tenantId, config.account_key, JSON.stringify(config)],
    );
    if (inserted.changes !== 1) {
      throw new Error(`channel config telegram:${config.account_key} already exists`);
    }
    return config;
  }

  async updateTelegram(input: {
    tenantId: string;
    accountKey: string;
    botToken?: string;
    clearBotToken?: boolean;
    webhookSecret?: string;
    clearWebhookSecret?: boolean;
    allowedUserIds?: string[];
    pipelineEnabled?: boolean;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    await this.ensureLegacyImported(input.tenantId);
    const current = await this.getTelegramByAccountKey({
      tenantId: input.tenantId,
      accountKey: input.accountKey,
    });
    if (!current) return undefined;
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

    const next = StoredTelegramChannelConfig.parse({
      channel: "telegram",
      account_key: current.account_key,
      ...(nextBotToken ? { bot_token: nextBotToken } : {}),
      ...(nextWebhookSecret ? { webhook_secret: nextWebhookSecret } : {}),
      allowed_user_ids: canonicalizeTelegramAllowedUserIds(
        input.allowedUserIds ?? current.allowed_user_ids,
      ),
      pipeline_enabled: input.pipelineEnabled ?? current.pipeline_enabled,
    });
    await this.assertUniqueTelegramWebhookSecret({
      tenantId: input.tenantId,
      webhookSecret: next.webhook_secret,
      accountKey: next.account_key,
    });

    await this.db.run(
      `UPDATE channel_configs
       SET config_json = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND connector_key = 'telegram'
         AND account_key = ?`,
      [JSON.stringify(next), new Date().toISOString(), input.tenantId, next.account_key],
    );
    return next;
  }

  async delete(input: {
    tenantId: string;
    connectorKey: string;
    accountKey: string;
  }): Promise<boolean> {
    await this.ensureLegacyImported(input.tenantId);
    const result = await this.db.run(
      `DELETE FROM channel_configs
       WHERE tenant_id = ?
         AND connector_key = ?
         AND account_key = ?`,
      [input.tenantId, input.connectorKey, input.accountKey],
    );
    return result.changes === 1;
  }

  async ensureLegacyImported(tenantId: string): Promise<void> {
    const existing = await this.db.get<{ account_key: string }>(
      `SELECT account_key
       FROM channel_configs
       WHERE tenant_id = ?
       LIMIT 1`,
      [tenantId],
    );
    if (existing?.account_key) return;

    const latest = await this.deploymentConfigDal.getLatest();
    if (!latest || !hasLegacyTelegramConfig(latest.config)) {
      return;
    }

    const channels = latest.config.channels;
    const legacy = StoredTelegramChannelConfig.parse({
      channel: "telegram",
      account_key: "default",
      ...(channels.telegramBotToken?.trim() ? { bot_token: channels.telegramBotToken } : {}),
      ...(channels.telegramWebhookSecret?.trim()
        ? { webhook_secret: channels.telegramWebhookSecret }
        : {}),
      allowed_user_ids: canonicalizeTelegramAllowedUserIds(channels.telegramAllowedUserIds ?? []),
      pipeline_enabled: channels.pipelineEnabled ?? true,
    });

    await this.db.run(
      `INSERT INTO channel_configs (
         tenant_id,
         connector_key,
         account_key,
         config_json
       )
       VALUES (?, 'telegram', ?, ?)
       ON CONFLICT (tenant_id, connector_key, account_key) DO NOTHING`,
      [tenantId, legacy.account_key, JSON.stringify(legacy)],
    );
    await this.db.run(
      `INSERT INTO channel_configs (
         tenant_id,
         connector_key,
         account_key,
         config_json
       )
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, connector_key, account_key) DO NOTHING`,
      [
        tenantId,
        LEGACY_IMPORT_MARKER_CONNECTOR_KEY,
        LEGACY_IMPORT_MARKER_ACCOUNT_KEY,
        JSON.stringify({ imported_from_legacy: true }),
      ],
    );
  }

  private async listRaw(input: {
    tenantId: string;
    connectorKey?: string;
  }): Promise<StoredChannelConfig[]> {
    const rows = await this.db.all<RawChannelConfigRow>(
      `SELECT tenant_id, connector_key, account_key, config_json
       FROM channel_configs
       WHERE tenant_id = ?
         AND connector_key != ?
         ${input.connectorKey ? "AND connector_key = ?" : ""}
       ORDER BY connector_key ASC, account_key ASC`,
      input.connectorKey
        ? [input.tenantId, LEGACY_IMPORT_MARKER_CONNECTOR_KEY, input.connectorKey]
        : [input.tenantId, LEGACY_IMPORT_MARKER_CONNECTOR_KEY],
    );
    return rows.map(parseStoredChannelConfigOrThrow);
  }

  private async assertUniqueTelegramWebhookSecret(input: {
    tenantId: string;
    webhookSecret?: string;
    accountKey?: string;
  }): Promise<void> {
    const secret = input.webhookSecret?.trim();
    if (!secret) return;

    const configs = await this.listTelegram(input.tenantId);
    const conflict = configs.find(
      (config) =>
        config.account_key !== input.accountKey &&
        webhookSecretsEqual(config.webhook_secret, secret),
    );
    if (conflict) {
      throw new Error(
        `telegram webhook secret is already used by account '${conflict.account_key}'`,
      );
    }
  }
}
