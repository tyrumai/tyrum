import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";

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

function makeAgents(runtime: unknown): AgentRegistry {
  return { getRuntime: async () => runtime } as unknown as AgentRegistry;
}

describe("Telegram E2E: webhook -> agent -> reply", () => {
  const originalWebhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];

  beforeEach(() => {
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-telegram-secret";
  });

  afterEach(() => {
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
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
    const body = (await res.json()) as { ok: boolean; session_id: string };
    expect(body.ok).toBe(true);
    expect(body.session_id).toBe("session-abc");

    expect(mockRuntime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          delivery: { channel: "telegram", account: "default" },
          container: { kind: "dm", id: "123" },
          sender: expect.objectContaining({ id: "999" }),
          content: { text: "Help me", attachments: [] },
          provenance: ["user"],
        }),
      }),
    );

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
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(true);
    expect(body.error).toBe("agent_error");

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

  it("processes non-text messages without captions by passing the normalized envelope through", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "Got it.",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
    const body = (await res.json()) as { ok: boolean; session_id?: string };
    expect(body.ok).toBe(true);
    expect(body.session_id).toBe("session-abc");
    expect(mockRuntime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          delivery: { channel: "telegram", account: "default" },
          container: { kind: "dm", id: "123" },
          sender: { id: "chat:123" },
          content: expect.objectContaining({
            attachments: [{ kind: "photo" }],
          }),
          provenance: ["user"],
        }),
      }),
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects webhook when secret header is missing", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime) }),
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
