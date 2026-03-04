import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";

describe("Ingress routes", () => {
  const prevSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];

  beforeEach(() => {
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-secret";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env["TELEGRAM_WEBHOOK_SECRET"];
    else process.env["TELEGRAM_WEBHOOK_SECRET"] = prevSecret;
  });

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

    const res = await app.request("/ingress/telegram?agent_key=default", {
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
});
