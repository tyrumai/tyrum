import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
const { secureStringEqual } = vi.hoisted(() => ({
  secureStringEqual: vi.fn((left: string, right: string) => left === right),
}));

vi.mock("../../src/utils/secure-string-equal.js", () => ({
  secureStringEqual,
}));

import {
  ChannelConfigDal,
  toChannelConfigView,
} from "../../src/modules/channels/channel-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("ChannelConfigDal", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let dal: ChannelConfigDal;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    dal = new ChannelConfigDal(db);
  });

  afterEach(async () => {
    secureStringEqual.mockClear();
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("creates, lists, updates, and deletes telegram configs", async () => {
    const created = await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
      allowedUserIds: ["123", "456"],
      pipelineEnabled: false,
    });
    expect(toChannelConfigView(created)).toMatchObject({
      channel: "telegram",
      account_key: "work",
      ingress_mode: "polling",
      bot_token_configured: true,
      webhook_secret_configured: true,
      allowed_user_ids: ["123", "456"],
      pipeline_enabled: false,
      polling_status: "idle",
      polling_last_error_at: null,
      polling_last_error_message: null,
    });

    const listed = await dal.listTelegram(DEFAULT_TENANT_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.account_key).toBe("work");

    const updated = await dal.updateTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      clearBotToken: true,
      ingressMode: "webhook",
      allowedUserIds: ["123"],
      pipelineEnabled: true,
    });
    expect(updated).toMatchObject({
      channel: "telegram",
      account_key: "work",
      ingress_mode: "webhook",
      webhook_secret: "webhook-secret",
      allowed_user_ids: ["123"],
      pipeline_enabled: true,
    });
    expect(updated?.bot_token).toBeUndefined();

    await expect(
      dal.delete({
        tenantId: DEFAULT_TENANT_ID,
        connectorKey: "telegram",
        accountKey: "work",
      }),
    ).resolves.toBe(true);
    await expect(dal.list(DEFAULT_TENANT_ID)).resolves.toEqual([]);
  });

  it("stores and replaces multi-channel account configs generically", async () => {
    await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "discord",
        account_key: "community",
        agent_key: "default",
        bot_token: "discord-token",
        allowed_user_ids: ["123"],
        allowed_channels: ["guild:1/channel:2"],
      },
    });
    await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "googlechat",
        account_key: "ops",
        agent_key: "agent-b",
        auth_method: "file_path",
        service_account_file: "/tmp/service-account.json",
        audience_type: "app-url",
        audience: "https://example.test/googlechat",
        allowed_users: ["users/123", "alice@example.com"],
      },
    });

    const listed = await dal.listEntries(DEFAULT_TENANT_ID);
    expect(listed).toHaveLength(2);
    expect(listed.map((entry) => entry.config.channel).toSorted()).toEqual([
      "discord",
      "googlechat",
    ]);

    const discord = await dal.getByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "discord",
      accountKey: "community",
    });
    expect(discord).toMatchObject({
      channel: "discord",
      agent_key: "default",
      allowed_channels: ["guild:1/channel:2"],
    });

    await dal.replace({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "googlechat",
        account_key: "ops",
        agent_key: "default",
        auth_method: "inline_json",
        service_account_json: '{"type":"service_account"}',
        audience_type: "project-number",
        audience: "123456789",
        allowed_users: ["users/456"],
      },
    });

    const googleChat = await dal.getByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "googlechat",
      accountKey: "ops",
    });
    expect(googleChat).toMatchObject({
      channel: "googlechat",
      agent_key: "default",
      auth_method: "inline_json",
      service_account_json: '{"type":"service_account"}',
      audience_type: "project-number",
      audience: "123456789",
      allowed_users: ["users/456"],
    });
    expect(googleChat).not.toHaveProperty("service_account_file");
  });

  it("rejects duplicate telegram webhook secrets across accounts", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      webhookSecret: "same-secret",
    });

    await expect(
      dal.createTelegram({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "personal",
        webhookSecret: "same-secret",
      }),
    ).rejects.toThrow(/already used/);
  });

  it("defaults new telegram configs to polling when ingress mode is omitted", async () => {
    const created = await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
    });

    expect(created).toMatchObject({
      channel: "telegram",
      account_key: "default",
      ingress_mode: "polling",
      bot_token: "bot-token",
      webhook_secret: "webhook-secret",
      allowed_user_ids: [],
      pipeline_enabled: true,
    });
  });

  it("uses secure string comparison when resolving telegram webhook secrets", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      webhookSecret: "exact-secret",
    });

    await expect(
      dal.getTelegramByWebhookSecret({
        tenantId: DEFAULT_TENANT_ID,
        webhookSecret: " exact-secret ",
      }),
    ).resolves.toMatchObject({ account_key: "work" });
    expect(secureStringEqual).toHaveBeenCalledWith("exact-secret", "exact-secret");
  });

  it("returns the first matching telegram account while still checking all secrets", async () => {
    vi.spyOn(dal, "listTelegram").mockResolvedValue([
      {
        channel: "telegram",
        account_key: "alpha",
        webhook_secret: "shared-secret",
        allowed_user_ids: [],
        pipeline_enabled: true,
      },
      {
        channel: "telegram",
        account_key: "omega",
        webhook_secret: "shared-secret",
        allowed_user_ids: [],
        pipeline_enabled: true,
      },
    ]);

    await expect(
      dal.getTelegramByWebhookSecret({
        tenantId: DEFAULT_TENANT_ID,
        webhookSecret: "shared-secret",
      }),
    ).resolves.toMatchObject({ account_key: "alpha" });
    expect(secureStringEqual).toHaveBeenCalledTimes(2);
  });

  it("does not import legacy telegram deployment config rows", async () => {
    await db.run(
      `INSERT INTO deployment_configs (config_json, created_by_json, reason)
       VALUES (?, ?, ?)`,
      [
        JSON.stringify({
          v: 1,
          channels: {
            telegramBotToken: "legacy-bot-token",
            telegramWebhookSecret: "legacy-webhook-secret",
            telegramAllowedUserIds: ["123"],
            pipelineEnabled: false,
          },
        }),
        "{}",
        "legacy",
      ],
    );

    await expect(dal.listTelegram(DEFAULT_TENANT_ID)).resolves.toEqual([]);
  });

  it("lists manually created telegram configs without consulting legacy deployment rows", async () => {
    await db.run(
      `INSERT INTO deployment_configs (config_json, created_by_json, reason)
       VALUES (?, ?, ?)`,
      [
        JSON.stringify({
          v: 1,
          channels: {
            telegramBotToken: "legacy-bot-token",
            telegramWebhookSecret: "legacy-webhook-secret",
          },
        }),
        "{}",
        "legacy",
      ],
    );

    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      botToken: "manual-bot-token",
      webhookSecret: "manual-webhook-secret",
    });

    await expect(dal.listTelegram(DEFAULT_TENANT_ID)).resolves.toEqual([
      {
        channel: "telegram",
        account_key: "default",
        ingress_mode: "polling",
        bot_token: "manual-bot-token",
        webhook_secret: "manual-webhook-secret",
        allowed_user_ids: [],
        pipeline_enabled: true,
      },
    ]);
  });

  it("preserves timezone-offset timestamps returned from storage", async () => {
    await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "discord",
        account_key: "community",
        agent_key: "default",
        allowed_user_ids: [],
        allowed_channels: [],
      },
    });
    await db.run(
      `UPDATE channel_configs
       SET created_at = ?, updated_at = ?
       WHERE tenant_id = ?
         AND connector_key = 'discord'
         AND account_key = ?`,
      ["2026-03-10 00:00:00+00", "2026-03-10 05:45:30+05:30", DEFAULT_TENANT_ID, "community"],
    );

    const entry = await dal.getEntryByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "discord",
      accountKey: "community",
    });
    expect(entry).toMatchObject({
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:15:30.000Z",
    });

    const listed = await dal.listEntries(DEFAULT_TENANT_ID);
    expect(listed).toContainEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          channel: "discord",
          account_key: "community",
        }),
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:15:30.000Z",
      }),
    );
  });
});
