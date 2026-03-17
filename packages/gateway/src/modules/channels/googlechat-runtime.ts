import {
  ChannelConfigDal,
  type StoredGoogleChatChannelConfig,
  type StoredChannelConfig,
} from "./channel-config-dal.js";

function asStoredGoogleChatConfig(
  config: StoredChannelConfig,
): StoredGoogleChatChannelConfig | undefined {
  return config.channel === "googlechat" ? config : undefined;
}

export class GoogleChatChannelRuntime {
  constructor(private readonly channelConfigDal: ChannelConfigDal) {}

  async listGoogleChatAccounts(tenantId: string): Promise<StoredGoogleChatChannelConfig[]> {
    const configs = await this.channelConfigDal.list(tenantId);
    return configs.flatMap((config) => {
      const account = asStoredGoogleChatConfig(config);
      return account ? [account] : [];
    });
  }

  async getGoogleChatAccountByAccountKey(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<StoredGoogleChatChannelConfig | undefined> {
    const config = await this.channelConfigDal.getByChannelAndAccountKey({
      tenantId: input.tenantId,
      connectorKey: "googlechat",
      accountKey: input.accountKey,
    });
    return config ? asStoredGoogleChatConfig(config) : undefined;
  }
}
