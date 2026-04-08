import { describe, expect, it } from "vitest";
import type { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import type { StoredTelegramChannelConfig } from "../../src/modules/channels/channel-config-dal.js";
import { TelegramChannelRuntime } from "../../src/modules/channels/telegram-runtime.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

function createConfig(
  accountKey: string,
  botToken: string,
  webhookSecret = `${accountKey}-secret`,
  debugLoggingEnabled = false,
): StoredTelegramChannelConfig {
  return {
    channel: "telegram",
    account_key: accountKey,
    ingress_mode: "polling",
    bot_token: botToken,
    webhook_secret: webhookSecret,
    allowed_user_ids: [],
    pipeline_enabled: true,
    debug_logging_enabled: debugLoggingEnabled,
  };
}

function createDal(configs: Map<string, StoredTelegramChannelConfig>): ChannelConfigDal {
  return {
    async listTelegram() {
      return Array.from(configs.values());
    },
    async getTelegramByAccountKey(input: { accountKey: string }) {
      return configs.get(input.accountKey);
    },
    async getTelegramByWebhookSecret() {
      return undefined;
    },
  } as ChannelConfigDal;
}

describe("TelegramChannelRuntime", () => {
  it("replaces cached bots when an account token rotates", async () => {
    const configs = new Map<string, StoredTelegramChannelConfig>([
      ["work", createConfig("work", "token-a")],
    ]);
    const runtime = new TelegramChannelRuntime(createDal(configs));

    const first = await runtime.getBotForAccount({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });
    const second = await runtime.getBotForAccount({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });

    expect(second).toBe(first);

    configs.set("work", createConfig("work", "token-b"));

    const rotated = await runtime.getBotForAccount({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });

    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(first);
  });

  it("drops cached bots when an account is removed", async () => {
    const configs = new Map<string, StoredTelegramChannelConfig>([
      ["work", createConfig("work", "token-a")],
    ]);
    const runtime = new TelegramChannelRuntime(createDal(configs));

    const first = await runtime.getBotForAccount({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });
    expect(first).toBeDefined();

    configs.delete("work");

    await expect(
      runtime.getBotForAccount({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "work",
      }),
    ).resolves.toBeUndefined();

    configs.set("work", createConfig("work", "token-a"));

    const recreated = await runtime.getBotForAccount({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });

    expect(recreated).toBeDefined();
    expect(recreated).not.toBe(first);
  });

  it("reuses cached bots for a preloaded telegram account config", async () => {
    const configs = new Map<string, StoredTelegramChannelConfig>([
      ["work", createConfig("work", "token-a")],
    ]);
    const runtime = new TelegramChannelRuntime(createDal(configs));
    const account = configs.get("work");

    expect(account).toBeDefined();
    if (!account) return;

    const first = runtime.getBotForTelegramAccount({
      tenantId: DEFAULT_TENANT_ID,
      account,
    });
    const second = runtime.getBotForTelegramAccount({
      tenantId: DEFAULT_TENANT_ID,
      account,
    });

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("marks egress connectors when account-level debug logging is enabled", async () => {
    const configs = new Map<string, StoredTelegramChannelConfig>([
      ["work", createConfig("work", "token-a", "work-secret", true)],
    ]);
    const runtime = new TelegramChannelRuntime(createDal(configs));

    await expect(runtime.listEgressConnectors(DEFAULT_TENANT_ID)).resolves.toMatchObject([
      {
        connector: "telegram",
        accountId: "work",
        debugLoggingEnabled: true,
      },
    ]);
  });
});
