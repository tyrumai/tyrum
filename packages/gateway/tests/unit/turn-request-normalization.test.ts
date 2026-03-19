import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/schemas";
import { describe, expect, it } from "vitest";
import {
  normalizeInternalTurnRequestIfNeeded,
  normalizeInternalTurnRequestUnknown,
} from "../../src/modules/agent/runtime/turn-request-normalization.js";

describe("turn request normalization", () => {
  it("does not re-normalize requests that already have parts", () => {
    const input: AgentTurnRequestT = {
      channel: "test",
      thread_id: "thread-1",
      parts: [{ type: "text", text: "hello" }],
    };

    expect(normalizeInternalTurnRequestIfNeeded(input)).toBe(input);
  });

  it("still normalizes legacy message-only requests", () => {
    const normalized = normalizeInternalTurnRequestUnknown({
      channel: "test",
      thread_id: "thread-1",
      message: "  hello  ",
    });

    expect(normalized).toEqual({
      channel: "test",
      thread_id: "thread-1",
      message: "  hello  ",
      parts: [{ type: "text", text: "hello" }],
    });
  });

  it("preserves envelope attachment parts for legacy message requests", () => {
    const normalized = normalizeInternalTurnRequestUnknown({
      envelope: {
        message_id: "msg-1",
        received_at: "2026-03-19T09:00:00.000Z",
        delivery: {
          channel: "telegram",
          account: "default",
        },
        container: {
          kind: "dm",
          id: "thread-1",
        },
        sender: {
          id: "user-1",
        },
        content: {
          text: "envelope text",
          attachments: [
            {
              artifact_id: "artifact-1",
              kind: "file",
              mime_type: "text/plain",
              external_url: "https://example.test/artifact-1",
              filename: "note.txt",
            },
          ],
        },
        provenance: ["user"],
      },
      message: "legacy text",
    });

    expect(normalized).toEqual({
      envelope: {
        message_id: "msg-1",
        received_at: "2026-03-19T09:00:00.000Z",
        delivery: {
          channel: "telegram",
          account: "default",
        },
        container: {
          kind: "dm",
          id: "thread-1",
        },
        sender: {
          id: "user-1",
        },
        content: {
          text: "envelope text",
          attachments: [
            {
              artifact_id: "artifact-1",
              kind: "file",
              mime_type: "text/plain",
              external_url: "https://example.test/artifact-1",
              filename: "note.txt",
            },
          ],
        },
        provenance: ["user"],
      },
      message: "legacy text",
      parts: [
        { type: "text", text: "legacy text" },
        {
          type: "file",
          url: "https://example.test/artifact-1",
          mediaType: "text/plain",
          filename: "note.txt",
        },
      ],
    });
  });
});
