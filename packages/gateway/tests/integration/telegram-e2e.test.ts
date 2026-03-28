import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { ArtifactStore } from "../../src/modules/artifact/store.js";

function createMediaFetch(filePath: string, bytes: Uint8Array, mediaType: string): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/getFile")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_id: "file-1",
            file_path: filePath,
            file_size: bytes.byteLength,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (url.includes("/file/bot")) {
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": mediaType },
      });
    }

    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function createArtifactStore(): {
  store: ArtifactStore;
  put: ReturnType<typeof vi.fn>;
} {
  const put = vi.fn(async (input: Parameters<ArtifactStore["put"]>[0]) => ({
    artifact_id: "11111111-1111-4111-8111-111111111111",
    uri: "artifact://11111111-1111-4111-8111-111111111111",
    external_url: "https://gateway.example/a/11111111-1111-4111-8111-111111111111",
    kind: "file" as const,
    media_class: "image" as const,
    created_at: "2024-03-09T16:00:00.000Z",
    filename: input.filename,
    mime_type: input.mime_type,
    size_bytes: input.body.byteLength,
    sha256: "a".repeat(64),
    labels: [],
    metadata: input.metadata,
  }));

  return {
    put,
    store: {
      put,
      get: vi.fn(),
      delete: vi.fn(),
    } satisfies ArtifactStore,
  };
}

const TEST_TELEGRAM_SECRET = "test-telegram-secret";

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

function makeTelegramRuntime(
  bot: TelegramBot,
  options?: {
    secret?: string;
    hasBotToken?: boolean;
  },
) {
  return {
    listTelegramAccounts: vi.fn(async () => [
      {
        account_key: "default",
        agent_key: "default",
        ingress_mode: "webhook" as const,
        ...(options?.hasBotToken === false ? {} : { bot_token: "test-token" }),
        webhook_secret: options?.secret ?? TEST_TELEGRAM_SECRET,
        allowed_user_ids: [],
        pipeline_enabled: true,
      },
    ]),
    getBotForTelegramAccount: vi.fn(() => bot),
  };
}

describe("Telegram E2E: webhook -> agent -> reply", () => {
  it("normalizes, calls agent turn, and replies via bot", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        conversation_id: "conversation-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(bot),
        agents: makeAgents(mockRuntime),
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": TEST_TELEGRAM_SECRET,
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

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
    expect(parsedBody["parse_mode"]).toBe("HTML");
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
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(bot),
        agents: makeAgents(mockRuntime),
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": TEST_TELEGRAM_SECRET,
      },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(true);
    expect(body.error).toBe("agent_error");

    // Verify error message was sent to user
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["text"]).toBe("Sorry, something went wrong. Please try again later.");
    expect(parsedBody["parse_mode"]).toBe("HTML");
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

  it("processes media-only messages by materializing attachments and passing the envelope through", async () => {
    const mediaFetch = createMediaFetch(
      "photos/file-1.jpg",
      Buffer.from("photo-bytes"),
      "image/jpeg",
    );
    const mediaBot = new TelegramBot("test-token", mediaFetch);
    const { store } = createArtifactStore();

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "Got it.",
        conversation_id: "conversation-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(mediaBot),
        agents: makeAgents(mockRuntime),
        artifactStore: store,
      }),
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
        "x-telegram-bot-api-secret-token": TEST_TELEGRAM_SECRET,
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockRuntime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          delivery: { channel: "telegram", account: "default" },
          container: { kind: "dm", id: "123" },
          sender: { id: "chat:123" },
          content: expect.objectContaining({
            attachments: [expect.objectContaining({ media_class: "image" })],
          }),
          provenance: ["user"],
        }),
      }),
    );
    expect(mediaFetch).toHaveBeenCalledTimes(3);
  });

  it("sends artifact-backed attachments through Telegram multipart endpoints on direct reply", async () => {
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const downloadFetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/artifact-1.png");
      return new Response(Buffer.from("artifact-bytes"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", downloadFetch);
    try {
      const mockRuntime = {
        turn: vi.fn().mockResolvedValue({
          reply: "Here is the screenshot.",
          conversation_id: "conversation-abc",
          used_tools: [],
          memory_written: false,
          attachments: [
            {
              artifact_id: "artifact-1",
              uri: "artifact://artifact-1",
              external_url: "https://cdn.example/artifact-1.png",
              kind: "file",
              media_class: "image",
              created_at: "2024-03-09T16:00:00.000Z",
              filename: "artifact-1.png",
              mime_type: "image/png",
              size_bytes: 14,
              labels: [],
            },
          ],
        }),
      };

      const app = new Hono();
      app.route(
        "/",
        createIngressRoutes({
          telegramBot: bot,
          telegramWebhookSecret: "test-telegram-secret",
          agents: makeAgents(mockRuntime),
          identityScopeDal: {
            resolvePrimaryAgentKey: vi.fn(async () => "default"),
          } as never,
        }),
      );

      const res = await app.request("/ingress/telegram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify(makeTelegramUpdate("Show me the screenshot")),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(downloadFetch).toHaveBeenCalledOnce();
      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain("/sendPhoto");
      const form = opts.body as FormData;
      expect(form.get("caption")).toBe("Here is the screenshot.");
      expect(form.get("photo")).toBeInstanceOf(Blob);
    } finally {
      vi.unstubAllGlobals();
    }
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
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(bot),
        agents: makeAgents(mockRuntime),
      }),
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
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(bot),
        agents: makeAgents(mockRuntime),
      }),
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
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn(),
    };

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: makeTelegramRuntime(bot, { secret: "", hasBotToken: true }),
        agents: makeAgents(mockRuntime),
      }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": TEST_TELEGRAM_SECRET,
      },
      body: JSON.stringify(makeTelegramUpdate("Hello")),
    });

    expect(res.status).toBe(503);
    expect(mockRuntime.turn).not.toHaveBeenCalled();
  });
});
