/**
 * Telegram normalization tests — port of shared/tyrum-shared/src/telegram.rs tests
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NormalizedThreadMessage as NormalizedThreadMessageSchema } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactStore } from "../../src/modules/artifact/store.js";
import {
  normalizeUpdate,
  normalizeUpdateWithMedia,
  TelegramNormalizationError,
} from "../../src/modules/ingress/telegram.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { telegramThreadKey } from "../../src/modules/channels/telegram.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID } from "../../src/modules/channels/interface.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../fixtures/telegram");

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}

function createTelegramMediaFetch(
  filePath: string,
  bytes: Uint8Array,
  mediaType: string,
): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/getFile")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_id: "ABC123",
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
    filename: input.filename ?? "artifact-11111111-1111-4111-8111-111111111111.jpg",
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

describe("Telegram normalization", () => {
  it("normalizes text message", () => {
    const update = normalizeUpdate(loadFixture("text_message.json"));

    expect(update.thread).toEqual({
      id: "987654321",
      kind: "private",
      title: undefined,
      username: undefined,
      pii_fields: [],
    });

    expect(update.message.id).toBe("111");
    expect(update.message.thread_id).toBe("987654321");
    expect(update.message.source).toBe("telegram");
    expect(update.message.content).toEqual({
      text: "Hello planner",
      attachments: [],
    });
    expect(update.message.sender).toEqual({
      id: "555555",
      is_bot: false,
      first_name: "Ron",
      last_name: "Swanson",
      username: "rons",
      language_code: "en",
    });
    expect(update.message.timestamp).toBe("2024-03-09T16:00:00.000Z");
    expect(update.message.edited_timestamp).toBeUndefined();
    expect(update.message.envelope).toEqual({
      message_id: "111",
      received_at: "2024-03-09T16:00:00.000Z",
      delivery: {
        channel: "telegram",
        account: DEFAULT_CHANNEL_ACCOUNT_ID,
      },
      container: {
        kind: "dm",
        id: "987654321",
      },
      sender: {
        id: "555555",
        display: "rons",
      },
      content: {
        text: "Hello planner",
        attachments: [],
      },
      provenance: ["user"],
    });
    expect(update.message.pii_fields).toEqual([
      "message_text",
      "sender_first_name",
      "sender_last_name",
      "sender_username",
      "sender_language_code",
    ]);
  });

  it("ignores TYRUM_TELEGRAM_ACCOUNT_ID for runtime normalization", () => {
    const prev = process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
    process.env["TYRUM_TELEGRAM_ACCOUNT_ID"] = "work";
    try {
      const update = normalizeUpdate(loadFixture("text_message.json"));
      expect(update.message.envelope?.delivery.account).toBe(DEFAULT_CHANNEL_ACCOUNT_ID);
    } finally {
      if (prev === undefined) {
        delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
      } else {
        process.env["TYRUM_TELEGRAM_ACCOUNT_ID"] = prev;
      }
    }
  });

  it("ignores legacy TYRUM_TELEGRAM_CHANNEL_KEY for runtime normalization", () => {
    const prev = process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    process.env["TYRUM_TELEGRAM_CHANNEL_KEY"] = "legacy-telegram-1";
    try {
      const update = normalizeUpdate(loadFixture("text_message.json"));
      expect(update.message.envelope?.delivery.account).toBe(DEFAULT_CHANNEL_ACCOUNT_ID);
    } finally {
      if (prev === undefined) {
        delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
      } else {
        process.env["TYRUM_TELEGRAM_CHANNEL_KEY"] = prev;
      }
    }
  });

  it("normalizes edited message", () => {
    const update = normalizeUpdate(loadFixture("edited_message.json"));

    expect(update.message.edited_timestamp).toBe("2024-03-09T16:10:00.000Z");
    expect(update.message.content).toEqual({
      text: "Hello planner edited",
      attachments: [],
    });
    expect(update.message.pii_fields).toContain("message_text");
  });

  it("materializes media messages as artifact-backed attachments", async () => {
    const fetchFn = createTelegramMediaFetch(
      "photos/file-1.jpg",
      Buffer.from("photo-bytes"),
      "image/jpeg",
    );
    const bot = new TelegramBot("123:ABC", fetchFn);
    const { store, put } = createArtifactStore();
    const update = await normalizeUpdateWithMedia(loadFixture("media_message.json"), {
      telegramBot: bot,
      artifactStore: store,
    });

    expect(update.thread.kind).toBe("supergroup");
    expect(update.thread.pii_fields).toContain("thread_title");
    expect(update.message.content).toMatchObject({
      text: "Check this out",
    });
    expect(update.message.content.attachments).toHaveLength(1);
    expect(update.message.content.attachments[0]).toMatchObject({
      artifact_id: "11111111-1111-4111-8111-111111111111",
      external_url: "https://gateway.example/a/11111111-1111-4111-8111-111111111111",
      media_class: "image",
      channel_kind: "photo",
      mime_type: "image/jpeg",
      filename: "artifact-11111111-1111-4111-8111-111111111111.jpg",
    });
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toMatchObject({
      kind: "file",
      mime_type: "image/jpeg",
      metadata: {
        source: "telegram-ingress",
        telegram: expect.objectContaining({
          channel_kind: "photo",
          message_id: "113",
        }),
      },
    });
    expect(update.message.envelope?.container.kind).toBe("group");
    expect(update.message.envelope?.content).toMatchObject({
      text: "Check this out",
    });
    expect(update.message.envelope?.content.attachments).toHaveLength(1);
    expect(update.message.envelope?.content.attachments[0]).toMatchObject({
      media_class: "image",
      channel_kind: "photo",
    });

    expect(update.message.pii_fields).toContain("message_text");
  });

  it("normalizes unknown media with caption", () => {
    const update = normalizeUpdate(loadFixture("unknown_media_caption.json"));

    expect(update.message.content).toEqual({
      text: "Future media caption",
      attachments: [],
    });

    expect(update.message.pii_fields).toContain("message_text");
  });

  it("rejects unknown payload", () => {
    expect(() => {
      normalizeUpdate('{"update_id": 1}');
    }).toThrow(TelegramNormalizationError);
  });

  it("rejects whitespace-only text messages", () => {
    const raw = JSON.stringify({
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        text: "   ",
      },
    });

    expect(() => normalizeUpdate(raw)).toThrow(TelegramNormalizationError);
  });

  it("drops whitespace-only captions from the envelope while preserving attachments", async () => {
    const fetchFn = createTelegramMediaFetch(
      "photos/file-2.jpg",
      Buffer.from("photo-bytes"),
      "image/jpeg",
    );
    const bot = new TelegramBot("123:ABC", fetchFn);
    const { store } = createArtifactStore();
    const raw = JSON.stringify({
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        caption: "  ",
        photo: [{ file_id: "abc" }],
      },
    });

    const update = await normalizeUpdateWithMedia(raw, {
      telegramBot: bot,
      artifactStore: store,
    });
    expect(update.message.envelope?.content.text).toBeUndefined();
    expect(update.message.content.attachments).toHaveLength(1);
    expect(update.message.envelope?.content.attachments).toHaveLength(1);
    expect(() => NormalizedThreadMessageSchema.parse(update)).not.toThrow();
  });
});

describe("telegramThreadKey", () => {
  it("requires container when thread is passed as a string", () => {
    expect(() => telegramThreadKey("123" as unknown as never)).toThrow(/container/i);
  });

  it("builds group keys when container is group", () => {
    expect(
      telegramThreadKey("555", {
        container: "group",
        agentId: "agent-1",
        accountId: "work",
      }),
    ).toBe("agent:agent-1:telegram:work:group:555");
  });

  it("builds channel keys when container is channel", () => {
    expect(
      telegramThreadKey("777", {
        container: "channel",
        agentId: "agent-1",
        accountId: "work",
      }),
    ).toBe("agent:agent-1:telegram:work:channel:777");
  });

  it("builds dm keys when container is dm", () => {
    expect(
      telegramThreadKey("999", {
        container: "dm",
        agentId: "agent-1",
        accountId: "work",
        dmScope: "per_account_channel_peer",
      }),
    ).toBe("agent:agent-1:telegram:work:dm:999");
  });

  it("falls back to message id when dm peer id is missing", () => {
    const normalized = {
      thread: {
        id: "",
        kind: "private",
        title: undefined,
        username: undefined,
        pii_fields: [],
      },
      message: {
        id: "111",
        thread_id: "",
        source: "telegram",
        content: { text: "Hello", attachments: [] },
        sender: undefined,
        timestamp: "2024-03-09T16:00:00.000Z",
        edited_timestamp: undefined,
        pii_fields: [],
      },
    } as const;

    expect(
      telegramThreadKey(normalized as unknown as never, {
        agentId: "agent-1",
        accountId: "work",
        dmScope: "per_account_channel_peer",
      }),
    ).toBe("agent:agent-1:telegram:work:dm:msg-111");
  });
});
