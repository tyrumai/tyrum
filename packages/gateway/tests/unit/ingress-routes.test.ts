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
    const telegramRuntime = {
      listTelegramAccounts: vi.fn(async () => [
        {
          account_key: "default",
          agent_key: "default",
          ingress_mode: "webhook",
          bot_token: "bot-token",
          webhook_secret: "test-secret",
          allowed_user_ids: [],
          pipeline_enabled: true,
        },
      ]),
      getBotForTelegramAccount: vi.fn(() => telegramBot),
    } as any;

    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime,
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
    const telegramRuntime = {
      listTelegramAccounts: vi.fn(async () => [
        {
          account_key: "work",
          agent_key: "default",
          ingress_mode: "webhook",
          bot_token: "bot-token",
          webhook_secret: "secret-work",
          allowed_user_ids: [],
          pipeline_enabled: true,
        },
      ]),
      getBotForTelegramAccount: vi.fn(() => ({ sendMessage: vi.fn(async () => undefined) })),
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
    expect(telegramRuntime.listTelegramAccounts).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(telegramRuntime.getBotForTelegramAccount).toHaveBeenCalledOnce();
  });

  it("emits telegram debug ingress diagnostics when enabled for a webhook account", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: "inbox-1" },
      deduped: false,
      message_text: "hi",
    }));
    const telegramRuntime = {
      listTelegramAccounts: vi.fn(async () => [
        {
          account_key: "work",
          agent_key: "default",
          ingress_mode: "webhook",
          bot_token: "bot-token",
          webhook_secret: "secret-work",
          allowed_user_ids: [],
          pipeline_enabled: true,
          debug_logging_enabled: true,
        },
      ]),
      getBotForTelegramAccount: vi.fn(() => ({ sendMessage: vi.fn(async () => undefined) })),
    } as any;

    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime,
        agents: {} as any,
        telegramQueue: { enqueue } as any,
        logger,
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
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.received_update",
      expect.objectContaining({
        debug_scope: "channel",
        account_key: "work",
        transport: "webhook",
        update_id: 1,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.normalized_update",
      expect.objectContaining({
        account_key: "work",
        thread_id: "123",
        message_id: "1",
        sender_id: "123",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.route",
      expect.objectContaining({
        account_key: "work",
        thread_id: "123",
        message_id: "1",
        routed_agent_id: "default",
        route_source: "account_agent_key",
      }),
    );
  });

  it("rejects runtime ingress when no bot-backed telegram accounts are configured", async () => {
    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime: {
          listTelegramAccounts: vi.fn(async () => [
            {
              account_key: "work",
              agent_key: "default",
              ingress_mode: "webhook",
              webhook_secret: "secret-work",
              allowed_user_ids: [],
              pipeline_enabled: true,
            },
          ]),
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
  });

  it("reports webhook-mode misconfiguration when all telegram accounts use polling", async () => {
    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime: {
          listTelegramAccounts: vi.fn(async () => [
            {
              account_key: "polling",
              agent_key: "default",
              ingress_mode: "polling",
              bot_token: "polling-token",
              webhook_secret: "polling-secret",
              allowed_user_ids: [],
              pipeline_enabled: true,
            },
          ]),
        } as any,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "polling-secret",
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
      message:
        "Telegram webhook ingress requires at least one webhook-mode account when Telegram ingress is enabled.",
    });
  });

  it("rejects webhook secrets that only belong to polling accounts", async () => {
    const telegramRuntime = {
      listTelegramAccounts: vi.fn(async () => [
        {
          account_key: "webhook",
          agent_key: "default",
          ingress_mode: "webhook",
          bot_token: "webhook-token",
          webhook_secret: "webhook-secret",
          allowed_user_ids: [],
          pipeline_enabled: true,
        },
        {
          account_key: "polling",
          agent_key: "default",
          ingress_mode: "polling",
          bot_token: "polling-token",
          webhook_secret: "polling-secret",
          allowed_user_ids: [],
          pipeline_enabled: true,
        },
      ]),
      getBotForTelegramAccount: vi.fn(() => ({ sendMessage: vi.fn(async () => undefined) })),
    } as any;

    const app = new Hono().route(
      "/",
      createIngressRoutes({
        telegramRuntime,
        agents: {} as any,
        telegramQueue: { enqueue: vi.fn() } as any,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "polling-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1_700_000_000,
          from: { id: 123, is_bot: false, first_name: "Alice" },
          chat: { id: 123, type: "private" },
          text: "hi",
        },
      }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: "unauthorized",
      message: "invalid telegram webhook secret",
    });
    expect(telegramRuntime.getBotForTelegramAccount).not.toHaveBeenCalled();
  });

  it("fails closed when telegram processing is configured without a telegram runtime", async () => {
    const app = new Hono().route(
      "/",
      createIngressRoutes({
        agents: {} as never,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
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
      message: "Telegram runtime must be configured when Telegram ingress is enabled.",
    });
  });
});
