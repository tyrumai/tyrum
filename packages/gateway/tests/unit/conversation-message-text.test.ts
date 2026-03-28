import { describe, expect, it } from "vitest";
import {
  renderEnvelopeMessageText,
  renderNormalizedThreadMessageText,
} from "../../src/modules/agent/conversation-message-text.js";
import type {
  NormalizedAttachment,
  NormalizedMessageEnvelope,
  NormalizedThreadMessage,
} from "@tyrum/contracts";

describe("renderEnvelopeMessageText", () => {
  it("returns empty string when no input is provided", () => {
    expect(renderEnvelopeMessageText({})).toBe("");
  });

  it("returns fallback text when no envelope", () => {
    expect(renderEnvelopeMessageText({ fallbackText: "hello" })).toBe("hello");
  });

  it("trims fallback text", () => {
    expect(renderEnvelopeMessageText({ fallbackText: "  hello  " })).toBe("hello");
  });

  it("returns only text when no attachments", () => {
    const envelope: NormalizedMessageEnvelope = {
      content: { attachments: [] },
      provenance: [],
    };
    expect(renderEnvelopeMessageText({ envelope, fallbackText: "hello" })).toBe("hello");
  });

  it("includes attachment summary when attachments are present", () => {
    const attachment: NormalizedAttachment = {
      artifact_id: "art-1",
      kind: "file",
      mime_type: "image/png",
    };
    const envelope: NormalizedMessageEnvelope = {
      content: { attachments: [attachment] },
      provenance: [],
    };
    const result = renderEnvelopeMessageText({ envelope, fallbackText: "check this" });
    expect(result).toContain("check this");
    expect(result).toContain("Attachments:");
    expect(result).toContain("kind=file");
    expect(result).toContain("mime_type=image/png");
  });

  it("includes size_bytes in attachment summary when available", () => {
    const attachment: NormalizedAttachment = {
      artifact_id: "art-2",
      kind: "file",
      size_bytes: 1024,
    };
    const envelope: NormalizedMessageEnvelope = {
      content: { attachments: [attachment] },
      provenance: [],
    };
    const result = renderEnvelopeMessageText({ envelope });
    expect(result).toContain("size_bytes=1024");
  });

  it("includes sha256 in attachment summary when available", () => {
    const attachment: NormalizedAttachment = {
      artifact_id: "art-3",
      kind: "file",
      sha256: "abc123",
    };
    const envelope: NormalizedMessageEnvelope = {
      content: { attachments: [attachment] },
      provenance: [],
    };
    const result = renderEnvelopeMessageText({ envelope });
    expect(result).toContain("sha256=abc123");
  });

  it("returns only attachments summary when text is empty", () => {
    const attachment: NormalizedAttachment = {
      artifact_id: "art-4",
      kind: "file",
    };
    const envelope: NormalizedMessageEnvelope = {
      content: { attachments: [attachment] },
      provenance: [],
    };
    const result = renderEnvelopeMessageText({ envelope, fallbackText: "" });
    expect(result).toContain("Attachments:");
    expect(result).not.toMatch(/^\n/);
  });
});

describe("renderNormalizedThreadMessageText", () => {
  it("renders a thread message with text", () => {
    const message: NormalizedThreadMessage = {
      thread: { id: "t1", kind: "dm" },
      message: {
        id: "m1",
        content: { text: "hello" },
      },
    } as unknown as NormalizedThreadMessage;
    expect(renderNormalizedThreadMessageText(message)).toBe("hello");
  });

  it("renders empty text when content text is null", () => {
    const message = {
      thread: { id: "t1", kind: "dm" },
      message: {
        id: "m1",
        content: { text: null },
      },
    } as unknown as NormalizedThreadMessage;
    expect(renderNormalizedThreadMessageText(message)).toBe("");
  });

  it("includes envelope attachments in rendered text", () => {
    const attachment: NormalizedAttachment = {
      artifact_id: "art-5",
      kind: "file",
      mime_type: "text/plain",
    };
    const message = {
      thread: { id: "t1", kind: "dm" },
      message: {
        id: "m1",
        content: { text: "see file" },
        envelope: {
          content: { attachments: [attachment] },
          provenance: [],
        },
      },
    } as unknown as NormalizedThreadMessage;

    const result = renderNormalizedThreadMessageText(message);
    expect(result).toContain("see file");
    expect(result).toContain("Attachments:");
  });
});
