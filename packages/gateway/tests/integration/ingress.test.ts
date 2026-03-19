import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
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

    return new Response(bytes, {
      status: 200,
      headers: { "content-type": mediaType },
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

describe("POST /ingress/telegram", () => {
  const app = new Hono();
  app.route("/", createIngressRoutes());

  it("normalizes a simple text message", async () => {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { id: string; kind: string };
      message: {
        id: string;
        source: string;
        content: { kind: string; text: string };
      };
    };
    expect(body.thread.id).toBe("123");
    expect(body.thread.kind).toBe("private");
    expect(body.message.id).toBe("42");
    expect(body.message.source).toBe("telegram");
    expect(body.message.content).toEqual({
      text: "Hello bot",
      attachments: [],
    });
  });

  it("materializes Telegram media into artifact-backed attachments when an artifact store is provided", async () => {
    const fetchFn = createMediaFetch("photos/file-1.jpg", Buffer.from("photo-bytes"), "image/jpeg");
    const bot = new TelegramBot("test-token", fetchFn);
    const { store, put } = createArtifactStore();
    const appWithArtifacts = new Hono();
    appWithArtifacts.route(
      "/",
      createIngressRoutes({
        telegramBot: bot,
        telegramWebhookSecret: "test-telegram-secret",
        artifactStore: store,
      }),
    );

    const update = {
      update_id: 102,
      message: {
        message_id: 50,
        date: 1700000000,
        chat: { id: 456, type: "group", title: "Team Chat" },
        from: { id: 999, is_bot: false, first_name: "Alice" },
        caption: "Check this out",
        photo: [{ file_id: "file-1", width: 800, height: 600 }],
      },
    };

    const res = await appWithArtifacts.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: {
        content: {
          text?: string;
          attachments: Array<{ artifact_id: string; external_url: string; media_class: string }>;
        };
        envelope?: {
          content: {
            attachments: Array<{ artifact_id: string; external_url: string; media_class: string }>;
          };
        };
      };
    };

    expect(body.message.content.text).toBe("Check this out");
    expect(body.message.content.attachments).toHaveLength(1);
    expect(body.message.content.attachments[0]).toMatchObject({
      artifact_id: "11111111-1111-4111-8111-111111111111",
      external_url: "https://gateway.example/a/11111111-1111-4111-8111-111111111111",
      media_class: "image",
    });
    expect(body.message.envelope?.content.attachments).toHaveLength(1);
    expect(put).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns 400 for empty body", async () => {
    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for update without message", async () => {
    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 101 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("normalization_error");
  });

  it("normalizes an edited message", async () => {
    const update = {
      update_id: 102,
      edited_message: {
        message_id: 50,
        date: 1700000000,
        edit_date: 1700000060,
        chat: {
          id: 456,
          type: "group",
          title: "Test Group",
        },
        text: "Edited text",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { kind: string; title: string };
      message: { content: { text: string }; edited_timestamp: string };
    };
    expect(body.thread.kind).toBe("group");
    expect(body.message.content.text).toBe("Edited text");
    expect(body.message.edited_timestamp).toBeDefined();
  });
});
