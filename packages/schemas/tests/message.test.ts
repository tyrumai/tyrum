import { describe, expect, it } from "vitest";
import {
  NormalizedThreadMessage,
  NormalizedThread,
  NormalizedMessage,
  NormalizedMessageEnvelope,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

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

  it("rejects a thread missing id", () => {
    expectRejects(NormalizedThread, { kind: "private" });
  });

  it("rejects a thread with invalid kind", () => {
    expectRejects(NormalizedThread, { id: "chat-1", kind: "unknown" });
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

  it("rejects a message with missing timestamp", () => {
    const bad = {
      id: "msg-1",
      thread_id: "chat-123",
      source: "telegram",
      content: { kind: "text", text: "Hello" },
    } as const;
    expectRejects(NormalizedMessage, bad);
  });

  it("rejects a text message with missing text", () => {
    const bad = {
      id: "msg-1",
      thread_id: "chat-123",
      source: "telegram",
      content: { kind: "text" },
      timestamp: "2025-10-05T16:31:09Z",
    } as const;
    expectRejects(NormalizedMessage, bad);
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
  const baseThreadMsg = {
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
  } as const;

  it("round-trips through parse/serialize", () => {
    const parsed = NormalizedThreadMessage.parse(baseThreadMsg);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = NormalizedThreadMessage.parse(json);
    expect(restored).toEqual(parsed);
  });

  it("rejects a thread message missing thread", () => {
    const bad = { ...baseThreadMsg } as Record<string, unknown>;
    delete bad.thread;
    expectRejects(NormalizedThreadMessage, bad);
  });

  it("rejects a thread message with message.thread_id mismatch type", () => {
    expectRejects(NormalizedThreadMessage, {
      ...baseThreadMsg,
      message: { ...baseThreadMsg.message, thread_id: 123 },
    });
  });
});

describe("NormalizedMessageEnvelope", () => {
  it("parses a v2 baseline normalized envelope", () => {
    const envelope = NormalizedMessageEnvelope.parse({
      message_id: "msg-1",
      received_at: "2025-10-05T16:31:09Z",
      delivery: {
        channel: "telegram",
        account: "default",
      },
      container: {
        kind: "dm",
        id: "chat-123",
      },
      sender: {
        id: "user-42",
        display: "Ron",
      },
      content: {
        text: "Hello, world!",
      },
      provenance: ["user"],
    });

    expect(envelope.delivery.channel).toBe("telegram");
    expect(envelope.container.kind).toBe("dm");
    expect(envelope.provenance).toEqual(["user"]);
  });

  it("rejects an envelope missing message_id", () => {
    const bad = {
      received_at: "2025-10-05T16:31:09Z",
      delivery: { channel: "telegram", account: "default" },
      container: { kind: "dm", id: "chat-123" },
      sender: { id: "user-42" },
      content: { text: "Hello" },
      provenance: ["user"],
    } as const;

    expectRejects(NormalizedMessageEnvelope, bad);
  });

  it("rejects an envelope with non-string content text", () => {
    expectRejects(NormalizedMessageEnvelope, {
      message_id: "msg-1",
      received_at: "2025-10-05T16:31:09Z",
      delivery: { channel: "telegram", account: "default" },
      container: { kind: "dm", id: "chat-123" },
      sender: { id: "user-42" },
      content: { text: 123 },
      provenance: ["user"],
    });
  });

  it("rejects empty content", () => {
    expect(() =>
      NormalizedMessageEnvelope.parse({
        message_id: "msg-1",
        received_at: "2025-10-05T16:31:09Z",
        delivery: {
          channel: "telegram",
          account: "default",
        },
        container: {
          kind: "group",
          id: "chat-123",
        },
        sender: {
          id: "user-42",
        },
        content: {},
        provenance: ["user"],
      }),
    ).toThrow();
  });
});

describe("normalizedContainerKindFromThreadKind", () => {
  it("maps ThreadKind to NormalizedContainerKind", async () => {
    const schemas = await import("../src/index.js");
    const normalizedContainerKindFromThreadKind = (
      schemas as {
        normalizedContainerKindFromThreadKind?: (kind: string) => string;
      }
    ).normalizedContainerKindFromThreadKind;

    expect(typeof normalizedContainerKindFromThreadKind).toBe("function");
    if (typeof normalizedContainerKindFromThreadKind !== "function") return;

    expect(normalizedContainerKindFromThreadKind("private")).toBe("dm");
    expect(normalizedContainerKindFromThreadKind("channel")).toBe("channel");
    expect(normalizedContainerKindFromThreadKind("group")).toBe("group");
    expect(normalizedContainerKindFromThreadKind("supergroup")).toBe("group");
    expect(normalizedContainerKindFromThreadKind("other")).toBe("group");
  });
});
