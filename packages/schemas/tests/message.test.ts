import { describe, expect, it } from "vitest";
import {
  NormalizedThreadMessage,
  NormalizedThread,
  NormalizedMessage,
} from "../src/index.js";

describe("NormalizedThread", () => {
  it("parses a valid thread", () => {
    const thread = NormalizedThread.parse({
      id: "chat-123",
      kind: "private",
      title: "My Chat",
      pii_fields: ["thread_title"],
    });
    expect(thread.id).toBe("chat-123");
    expect(thread.kind).toBe("private");
    expect(thread.pii_fields).toEqual(["thread_title"]);
  });

  it("defaults pii_fields to empty array", () => {
    const thread = NormalizedThread.parse({
      id: "chat-456",
      kind: "group",
    });
    expect(thread.pii_fields).toEqual([]);
  });
});

describe("NormalizedMessage", () => {
  it("parses text message content", () => {
    const msg = NormalizedMessage.parse({
      id: "msg-1",
      thread_id: "chat-123",
      source: "telegram",
      content: { kind: "text", text: "Hello, world!" },
      timestamp: "2025-10-05T16:31:09Z",
    });
    expect(msg.content.kind).toBe("text");
    if (msg.content.kind === "text") {
      expect(msg.content.text).toBe("Hello, world!");
    }
  });

  it("parses media placeholder content", () => {
    const msg = NormalizedMessage.parse({
      id: "msg-2",
      thread_id: "chat-123",
      source: "telegram",
      content: { kind: "media_placeholder", media_kind: "photo", caption: "A sunset" },
      timestamp: "2025-10-05T16:31:09Z",
    });
    expect(msg.content.kind).toBe("media_placeholder");
  });
});

describe("NormalizedThreadMessage", () => {
  it("round-trips through parse/serialize", () => {
    const threadMsg = {
      thread: {
        id: "chat-123",
        kind: "private" as const,
        pii_fields: [],
      },
      message: {
        id: "msg-1",
        thread_id: "chat-123",
        source: "telegram" as const,
        content: { kind: "text" as const, text: "Test" },
        timestamp: "2025-10-05T16:31:09Z",
        pii_fields: [],
      },
    };

    const parsed = NormalizedThreadMessage.parse(threadMsg);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = NormalizedThreadMessage.parse(json);
    expect(restored).toEqual(parsed);
  });
});
