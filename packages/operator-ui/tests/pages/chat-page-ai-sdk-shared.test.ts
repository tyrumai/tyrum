import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  applySessionMessages,
  buildPreview,
  patchSessionList,
  toThreadSummary,
} from "../../src/components/pages/chat-page-ai-sdk-shared.js";

describe("chat-page-ai-sdk-shared", () => {
  it("builds previews from the latest non-empty text part", () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "   " }],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "source-url", url: "https://example.com" },
          { type: "text", text: "Latest answer" },
        ],
      },
    ] as unknown as UIMessage[];

    expect(buildPreview(messages)).toEqual({ role: "assistant", text: "Latest answer" });
  });

  it("builds previews from file-only messages when no text is available", () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "screenshot.png",
            url: "data:image/png;base64,AAAA",
          },
        ],
      },
    ] as unknown as UIMessage[];

    expect(buildPreview(messages)).toEqual({ role: "user", text: "screenshot.png" });
  });

  it("applies message updates and refreshes preview metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T06:00:00.000Z"));

    const session = {
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-1",
      queue_mode: "steer" as const,
      title: "Thread title",
      created_at: "2026-03-13T00:00:00.000Z",
      updated_at: "2026-03-13T00:00:00.000Z",
      message_count: 0,
      last_message: null,
      messages: [],
    };
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Compacted reply" }],
      },
    ] as unknown as UIMessage[];

    expect(applySessionMessages(session, messages)).toEqual({
      ...session,
      messages,
      message_count: 1,
      last_message: { role: "assistant", text: "Compacted reply" },
      updated_at: "2026-03-14T06:00:00.000Z",
    });

    vi.useRealTimers();
  });

  it("patches session lists by replacing existing sessions and promoting them", () => {
    const existing = [
      {
        session_id: "session-1",
        agent_id: "default",
        channel: "ui",
        thread_id: "thread-1",
        title: "Old title",
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
        message_count: 1,
        last_message: { role: "assistant", text: "old" },
      },
      {
        session_id: "session-2",
        agent_id: "default",
        channel: "ui",
        thread_id: "thread-2",
        title: "Other thread",
        created_at: "2026-03-12T00:00:00.000Z",
        updated_at: "2026-03-12T00:00:00.000Z",
        message_count: 1,
        last_message: { role: "assistant", text: "other" },
      },
    ];
    const updated = {
      ...existing[0],
      queue_mode: "steer" as const,
      title: "New title",
      last_message: { role: "assistant", text: "new" },
      messages: [],
    };

    expect(patchSessionList(existing, updated)).toEqual([updated, existing[1]]);
  });

  it("derives thread summaries from trimmed title and preview text", () => {
    const summary = toThreadSummary({
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-1",
      title: "  Session title \nignored",
      created_at: "2026-03-13T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
      message_count: 2,
      last_message: { role: "user", text: " Preview line \nignored" },
    });

    expect(summary).toEqual({
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-1",
      title: "Session title",
      created_at: "2026-03-13T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
      message_count: 2,
      preview: "Preview line",
      archived: false,
    });
  });

  it("falls back to New chat when a session title is blank", () => {
    const summary = toThreadSummary({
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-1",
      title: "   ",
      created_at: "2026-03-13T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
      message_count: 0,
      last_message: null,
    });

    expect(summary.title).toBe("New chat");
  });

  it("uses an attachment label when a session has messages but no text preview", () => {
    const summary = toThreadSummary({
      session_id: "session-2",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-2",
      title: "",
      created_at: "2026-03-13T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
      message_count: 1,
      last_message: null,
    });

    expect(summary.preview).toBe("Attachment");
  });
});
