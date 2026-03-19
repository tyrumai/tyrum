import type { ChannelEgressConnector } from "./interface.js";
import { ChannelConfigDal, type StoredTelegramChannelConfig } from "./channel-config-dal.js";
import { TelegramBot } from "../ingress/telegram-bot.js";
import { createTelegramEgressConnector } from "./telegram-shared.js";
import type { ArtifactStore } from "../artifact/store.js";

type CachedTelegramBot = {
  token: string;
  bot: TelegramBot;
};

export class TelegramChannelRuntime {
  private readonly botCache = new Map<string, Map<string, CachedTelegramBot>>();

  constructor(
    private readonly channelConfigDal: ChannelConfigDal,
    private readonly artifactStore?: ArtifactStore,
  ) {}

  async listTelegramAccounts(tenantId: string): Promise<StoredTelegramChannelConfig[]> {
    return await this.channelConfigDal.listTelegram(tenantId);
  }

  async getTelegramAccountByAccountKey(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    return await this.channelConfigDal.getTelegramByAccountKey(input);
  }

  async getTelegramAccountByWebhookSecret(input: {
    tenantId: string;
    webhookSecret: string;
  }): Promise<StoredTelegramChannelConfig | undefined> {
    return await this.channelConfigDal.getTelegramByWebhookSecret(input);
  }

  async getBotForAccount(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<TelegramBot | undefined> {
    const config = await this.getTelegramAccountByAccountKey(input);
    if (!config) {
      this.deleteCachedBot(input.tenantId, input.accountKey);
      return undefined;
    }
    return this.getBot(config, input.tenantId);
  }

  getBotForTelegramAccount(input: {
    tenantId: string;
    account: StoredTelegramChannelConfig;
  }): TelegramBot | undefined {
    return this.getBot(input.account, input.tenantId);
  }

  async listEgressConnectors(tenantId: string): Promise<ChannelEgressConnector[]> {
    const configs = await this.listTelegramAccounts(tenantId);
    this.pruneTenantBots(
      tenantId,
      new Set(configs.flatMap((config) => (config.bot_token?.trim() ? [config.account_key] : []))),
    );
    return configs.flatMap((config) => {
      const bot = this.getBot(config, tenantId);
      return bot
        ? [createTelegramEgressConnector(bot, config.account_key, this.artifactStore)]
        : [];
    });
  }

  private getBot(config: StoredTelegramChannelConfig, tenantId: string): TelegramBot | undefined {
    const token = config.bot_token?.trim();
    if (!token) {
      this.deleteCachedBot(tenantId, config.account_key);
      return undefined;
    }
    const tenantCache = this.getTenantCache(tenantId);
    const existing = tenantCache.get(config.account_key);
    if (existing?.token === token) return existing.bot;
    const bot = new TelegramBot(token);
    tenantCache.set(config.account_key, { token, bot });
    return bot;
  }

  private getTenantCache(tenantId: string): Map<string, CachedTelegramBot> {
    const existing = this.botCache.get(tenantId);
    if (existing) return existing;
    const cache = new Map<string, CachedTelegramBot>();
    this.botCache.set(tenantId, cache);
    return cache;
  }

  private deleteCachedBot(tenantId: string, accountKey: string): void {
    const tenantCache = this.botCache.get(tenantId);
    if (!tenantCache) return;
    tenantCache.delete(accountKey);
    if (tenantCache.size === 0) {
      this.botCache.delete(tenantId);
    }
  }

  private pruneTenantBots(tenantId: string, activeAccountKeys: Set<string>): void {
    const tenantCache = this.botCache.get(tenantId);
    if (!tenantCache) return;
    for (const accountKey of tenantCache.keys()) {
      if (!activeAccountKeys.has(accountKey)) {
        tenantCache.delete(accountKey);
      }
    }
    if (tenantCache.size === 0) {
      this.botCache.delete(tenantId);
    }
  }
}
