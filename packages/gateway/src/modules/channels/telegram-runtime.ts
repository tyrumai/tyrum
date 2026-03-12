import type { ChannelEgressConnector } from "./interface.js";
import { ChannelConfigDal, type StoredTelegramChannelConfig } from "./channel-config-dal.js";
import { TelegramBot } from "../ingress/telegram-bot.js";
import { createTelegramEgressConnector } from "./telegram-shared.js";

export class TelegramChannelRuntime {
  private readonly botCache = new Map<string, TelegramBot>();

  constructor(private readonly channelConfigDal: ChannelConfigDal) {}

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
    return config ? this.getBot(config, input.tenantId) : undefined;
  }

  async listEgressConnectors(tenantId: string): Promise<ChannelEgressConnector[]> {
    const configs = await this.listTelegramAccounts(tenantId);
    return configs.flatMap((config) => {
      const bot = this.getBot(config, tenantId);
      return bot ? [createTelegramEgressConnector(bot, config.account_key)] : [];
    });
  }

  private getBot(config: StoredTelegramChannelConfig, tenantId: string): TelegramBot | undefined {
    const token = config.bot_token?.trim();
    if (!token) return undefined;
    const key = `${tenantId}:${config.account_key}:${token}`;
    const existing = this.botCache.get(key);
    if (existing) return existing;
    const bot = new TelegramBot(token);
    this.botCache.set(key, bot);
    return bot;
  }
}
