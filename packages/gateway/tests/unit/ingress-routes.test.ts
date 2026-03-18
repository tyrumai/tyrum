import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";

describe("Ingress routes", () => {
  it("logs when durable routing config load fails", async () => {
    const logger = { warn: vi.fn() } as any;
    const routingConfigDal = {
      getLatest: vi.fn(async () => {
        throw new Error("db down");
      }),
    } as any;
    const telegramQueue = {
      enqueue: vi.fn(async () => ({
        inbox: { status: "queued", inbox_id: "inbox-1" },
        deduped: false,
        message_text: "hi",
      })),
    } as any;
    const telegramBot = { sendMessage: vi.fn(async () => {}) } as any;
    const agents = {} as any;

    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramBot,
        telegramWebhookSecret: "test-secret",
        agents,
        telegramQueue,
        routingConfigDal,
        logger,
      }),
    );

    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        chat: { id: 123, type: "private" },
        text: "hi",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "ingress.telegram.routing_config_load_failed",
      expect.objectContaining({ error: "db down" }),
    );
  });

  it("reuses preloaded webhook-matched account state and only reloads the account binding", async () => {
    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: "inbox-1" },
      deduped: false,
      message_text: "hi",
    }));
    const getTelegramAccountByWebhookSecret = vi.fn(async () => undefined);
    const getTelegramAccountByAccountKey = vi.fn(async () => undefined);
    const getBotForAccount = vi.fn(async () => undefined);
    const telegramRuntime = {
      listTelegramAccounts: vi.fn(async () => [
        {
          account_key: "work",
          bot_token: "bot-token",
          webhook_secret: "secret-work",
          allowed_user_ids: [],
          pipeline_enabled: true,
        },
      ]),
      getTelegramAccountByWebhookSecret,
      getBotForAccount,
      getBotForTelegramAccount: vi.fn(() => ({ sendMessage: vi.fn(async () => undefined) })),
      getTelegramAccountByAccountKey,
    } as any;

    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime,
        agents: {} as any,
        telegramQueue: { enqueue } as any,
      }),
    );

    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        from: { id: 123, is_bot: false, first_name: "Alice" },
        chat: { id: 123, type: "private" },
        text: "hi",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "secret-work",
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(getTelegramAccountByWebhookSecret).not.toHaveBeenCalled();
    expect(getTelegramAccountByAccountKey).toHaveBeenCalledOnce();
    expect(getTelegramAccountByAccountKey).toHaveBeenCalledWith({
      tenantId: "00000000-0000-4000-8000-000000000001",
      accountKey: "work",
    });
    expect(getBotForAccount).not.toHaveBeenCalled();
  });

  it("rejects runtime ingress when no bot-backed telegram accounts are configured", async () => {
    const getTelegramAccountByWebhookSecret = vi.fn(async () => undefined);
    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime: {
          listTelegramAccounts: vi.fn(async () => [
            {
              account_key: "work",
              webhook_secret: "secret-work",
              allowed_user_ids: [],
              pipeline_enabled: true,
            },
          ]),
          getTelegramAccountByWebhookSecret,
          getBotForAccount: vi.fn(async () => undefined),
        } as any,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1_700_000_000,
          chat: { id: 123, type: "private" },
          text: "hi",
        },
      }),
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "misconfigured",
      message: "Telegram bot token must be configured when Telegram ingress is enabled.",
    });
    expect(getTelegramAccountByWebhookSecret).not.toHaveBeenCalled();
  });
});
