import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ChannelWorker } from "../../src/modules/channels/worker.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function makeTelegramUpdate(text: string, chatId = 123) {
  return {
    update_id: 100,
    message: {
      message_id: 42,
      date: 1700000000,
      from: { id: 999, is_bot: false, first_name: "Alice" },
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

function mockFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"ok":true}'),
    json: () => Promise.resolve({ ok: true }),
  }) as unknown as typeof fetch;
}

describe("Telegram E2E: webhook -> agent -> reply", () => {
  const originalWebhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  let db: SqliteDb | undefined;
  let memoryDal: MemoryDal | undefined;
  let approvalDal: ApprovalDal | undefined;

  beforeEach(() => {
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-telegram-secret";
    db = openTestSqliteDb();
    memoryDal = new MemoryDal(db);
    approvalDal = new ApprovalDal(db);
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
    memoryDal = undefined;
    approvalDal = undefined;
    if (originalWebhookSecret === undefined) {
      delete process.env["TELEGRAM_WEBHOOK_SECRET"];
    } else {
      process.env["TELEGRAM_WEBHOOK_SECRET"] = originalWebhookSecret;
    }
  });

  it("normalizes, calls agent turn, and replies via bot", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    } as unknown as AgentRuntime;

    const channelWorker = new ChannelWorker({
      db: db!,
      memoryDal: memoryDal!,
      agentRuntime: mockRuntime,
      telegramBot: bot,
      approvalDal: approvalDal!,
      debounceMs: 0,
      tickMs: 10_000,
    });

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramBot: bot,
        agentRuntime: mockRuntime,
        channelWorker,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");

    await channelWorker.tick();

    // Verify agent was called with correct params
    expect(mockRuntime.turn).toHaveBeenCalledWith({
      channel: "telegram",
      thread_id: "agent:default:telegram:default:dm:999",
      message: "Help me",
      metadata: { provenance_sources: ["user"] },
    });

    // Verify bot sent the reply
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/sendMessage");
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["chat_id"]).toBe("123");
    expect(parsedBody["text"]).toBe("I can help with that!");
  });

  it("sends error message when agent throws", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    } as unknown as AgentRuntime;

    const channelWorker = new ChannelWorker({
      db: db!,
      memoryDal: memoryDal!,
      agentRuntime: mockRuntime,
      telegramBot: bot,
      approvalDal: approvalDal!,
      debounceMs: 0,
      tickMs: 10_000,
    });

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramBot: bot,
        agentRuntime: mockRuntime,
        channelWorker,
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");

    await channelWorker.tick();

    // Verify error message was sent to user
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["text"]).toBe(
      "Sorry, something went wrong. Please try again later.",
    );
  });

  it("falls back to normalization-only when no deps provided", async () => {
    const app = new Hono();
    app.route("/", createIngressRoutes());

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeTelegramUpdate("Hello bot")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { id: string };
      message: { content: { text: string } };
    };
    expect(body.thread.id).toBe("123");
    expect(body.message.content.text).toBe("Hello bot");
  });

  it("returns ok for non-text messages without caption", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    } as unknown as AgentRuntime;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agentRuntime: mockRuntime }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        photo: [{ file_id: "abc" }],
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // Agent should not be called for empty text
    expect(mockRuntime.turn).not.toHaveBeenCalled();
  });

  it("rejects webhook when secret header is missing", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    } as unknown as AgentRuntime;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agentRuntime: mockRuntime }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(401);
    expect(mockRuntime.turn).not.toHaveBeenCalled();
  });

  it("rejects webhook when secret is wrong", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    } as unknown as AgentRuntime;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agentRuntime: mockRuntime }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(401);
    expect(mockRuntime.turn).not.toHaveBeenCalled();
  });

  it("fails closed when telegram secret is not configured", async () => {
    delete process.env["TELEGRAM_WEBHOOK_SECRET"];

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    } as unknown as AgentRuntime;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agentRuntime: mockRuntime }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(503);
    expect(mockRuntime.turn).not.toHaveBeenCalled();
  });
});
