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
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
      allowedUserIds: ["123", "456"],
      pipelineEnabled: false,
    });
    expect(toChannelConfigView(created)).toMatchObject({
      channel: "telegram",
      account_key: "work",
      bot_token_configured: true,
      webhook_secret_configured: true,
      allowed_user_ids: ["123", "456"],
      pipeline_enabled: false,
    });

    const listed = await dal.listTelegram(DEFAULT_TENANT_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.account_key).toBe("work");

    const updated = await dal.updateTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      clearBotToken: true,
      allowedUserIds: ["123"],
      pipelineEnabled: true,
    });
    expect(updated).toMatchObject({
      channel: "telegram",
      account_key: "work",
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

  it("imports the legacy singleton telegram deployment config into the default account once", async () => {
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

    const firstList = await dal.listTelegram(DEFAULT_TENANT_ID);
    expect(firstList).toEqual([
      {
        channel: "telegram",
        account_key: "default",
        bot_token: "legacy-bot-token",
        webhook_secret: "legacy-webhook-secret",
        allowed_user_ids: ["123"],
        pipeline_enabled: false,
      },
    ]);

    const secondList = await dal.listTelegram(DEFAULT_TENANT_ID);
    expect(secondList).toEqual(firstList);

    const rowCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_configs WHERE tenant_id = ? AND connector_key = 'telegram'",
      [DEFAULT_TENANT_ID],
    );
    expect(rowCount?.count).toBe(1);
  });

  it("does not re-import the legacy singleton after the imported config is deleted", async () => {
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

    await expect(dal.listTelegram(DEFAULT_TENANT_ID)).resolves.toHaveLength(1);
    await expect(
      dal.delete({
        tenantId: DEFAULT_TENANT_ID,
        connectorKey: "telegram",
        accountKey: "default",
      }),
    ).resolves.toBe(true);
    await expect(dal.listTelegram(DEFAULT_TENANT_ID)).resolves.toEqual([]);
  });
});
