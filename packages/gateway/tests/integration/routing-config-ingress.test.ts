import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";

describe("routing config (durable) + ingress", () => {
  let db: SqliteDb;
  let previousWebhookSecret: string | undefined;

  beforeEach(() => {
    db = openTestSqliteDb();
    previousWebhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-secret";
  });

  afterEach(async () => {
    if (typeof previousWebhookSecret === "string") {
      process.env["TELEGRAM_WEBHOOK_SECRET"] = previousWebhookSecret;
    } else {
      delete process.env["TELEGRAM_WEBHOOK_SECRET"];
    }
    await db.close();
  });

  it("routes telegram updates using durable routing config state", async () => {
    const routing = new RoutingConfigDal(db);
    await routing.set({
      config: {
        v: 1,
        telegram: {
          default_agent_id: "default",
          threads: {
            "123": "agent-b",
          },
        },
      },
      createdBy: { kind: "test" },
      reason: "seed",
      occurredAtIso: "2026-02-24T00:00:00.000Z",
    });

    let capturedAgentId: string | undefined;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramBot: {} as never,
        agents: {} as never,
        telegramQueue: {
          enqueue: async (_normalized, opts) => {
            capturedAgentId = opts?.agentId;
            return {
              inbox: { inbox_id: 1, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        routingConfigDal: routing,
      } as never),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-secret",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(capturedAgentId).toBe("agent-b");
  });
});

