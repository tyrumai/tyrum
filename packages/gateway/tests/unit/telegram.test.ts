/**
 * Telegram normalization tests — port of shared/tyrum-shared/src/telegram.rs tests
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NormalizedThreadMessage as NormalizedThreadMessageSchema } from "@tyrum/schemas";
import {
  normalizeUpdate,
  TelegramNormalizationError,
} from "../../src/modules/ingress/telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../fixtures/telegram");

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
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
      kind: "text",
      text: "Hello planner",
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
        account: "default",
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

  it("normalizes edited message", () => {
    const update = normalizeUpdate(loadFixture("edited_message.json"));

    expect(update.message.edited_timestamp).toBe("2024-03-09T16:10:00.000Z");
    expect(update.message.content).toEqual({
      kind: "text",
      text: "Hello planner edited",
    });
    expect(update.message.pii_fields).toContain("message_text");
  });

  it("normalizes media message", () => {
    const update = normalizeUpdate(loadFixture("media_message.json"));

    expect(update.thread.kind).toBe("supergroup");
    expect(update.thread.pii_fields).toContain("thread_title");

    expect(update.message.content.kind).toBe("media_placeholder");
    if (update.message.content.kind === "media_placeholder") {
      expect(update.message.content.media_kind).toBe("photo");
      expect(update.message.content.caption).toBe("Check this out");
    }

    expect(update.message.envelope?.container.kind).toBe("group");
    expect(update.message.envelope?.content).toEqual({
      text: "Check this out",
      attachments: [{ kind: "photo" }],
    });

    expect(update.message.pii_fields).toContain("message_caption");
  });

  it("normalizes unknown media with caption", () => {
    const update = normalizeUpdate(
      loadFixture("unknown_media_caption.json"),
    );

    expect(update.message.content.kind).toBe("media_placeholder");
    if (update.message.content.kind === "media_placeholder") {
      expect(update.message.content.media_kind).toBe("unknown");
      expect(update.message.content.caption).toBe("Future media caption");
    }

    expect(update.message.pii_fields).toContain("message_caption");
  });

  it("rejects unknown payload", () => {
    expect(() => {
      normalizeUpdate('{"update_id": 1}');
    }).toThrow(TelegramNormalizationError);
  });

  it("omits envelope for whitespace-only text messages (envelope contract requires non-empty text)", () => {
    const raw = JSON.stringify({
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        text: "   ",
      },
    });

    const update = normalizeUpdate(raw);
    expect(update.message.envelope).toBeUndefined();
    expect(() => NormalizedThreadMessageSchema.parse(update)).not.toThrow();
  });

  it("drops whitespace-only captions from the envelope while preserving attachments", () => {
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

    const update = normalizeUpdate(raw);
    expect(update.message.envelope?.content.text).toBeUndefined();
    expect(update.message.envelope?.content.attachments).toEqual([{ kind: "photo" }]);
    expect(() => NormalizedThreadMessageSchema.parse(update)).not.toThrow();
  });
});
