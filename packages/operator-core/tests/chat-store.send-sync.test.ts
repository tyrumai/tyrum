import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function sampleListItem(sessionId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
    title: "",
    summary: "",
    transcript_count: 1,
    updated_at: updatedAt,
    created_at: updatedAt,
    last_text: { role: "user", content: "hello" },
  } as const;
}

function sampleGetSession(sessionId: string) {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
    title: "",
    summary: "",
    transcript: [
      {
        kind: "text" as const,
        id: `${sessionId}-user-1`,
        role: "user" as const,
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

function sampleGetSessionWithAssistant(
  sessionId: string,
  input: { userContent: string; assistantContent: string },
) {
  const base = sampleGetSession(sessionId);
  return {
    ...base,
    transcript: [
      ...base.transcript,
      {
        kind: "text" as const,
        id: `${sessionId}-user-2`,
        role: "user" as const,
        content: input.userContent,
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        kind: "text" as const,
        id: `${sessionId}-assistant-1`,
        role: "assistant" as const,
        content: input.assistantContent,
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ],
    updated_at: "2026-01-01T00:00:02.000Z",
  } as const;
}

function createFakeWs() {
  return {
    sessionList: vi.fn(async () => ({ sessions: [], next_cursor: null })),
    sessionGet: vi.fn(async () => ({ session: sampleGetSession("session-1") })),
    sessionCreate: vi.fn(async () => ({
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      title: "",
    })),
    sessionCompact: vi.fn(async () => ({
      session_id: "session-1",
      dropped_messages: 0,
      kept_messages: 0,
    })),
    sessionDelete: vi.fn(async () => ({ session_id: "session-1" })),
    sessionSend: vi.fn(async () => ({ session_id: "session-1", assistant_message: "" })),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createFakeHttp() {
  return {
    agentList: {
      get: vi.fn(async () => ({ agents: [] })),
    },
  };
}

describe("chatStore post-send sync", () => {
  it("rehydrates the active transcript after send when live assistant events are absent", async () => {
    const ws = createFakeWs();
    ws.sessionGet
      .mockResolvedValueOnce({ session: sampleGetSession("session-1") })
      .mockResolvedValueOnce({
        session: sampleGetSessionWithAssistant("session-1", {
          userContent: "Testing 1 2 3",
          assistantContent: "Testing received. How can I help?",
        }),
      });
    ws.sessionList.mockResolvedValue({
      sessions: [
        {
          ...sampleListItem("session-1", "2026-01-01T00:00:02.000Z"),
          transcript_count: 3,
          last_text: { role: "assistant", content: "Testing received. How can I help?" },
        },
      ],
      next_cursor: null,
    });

    const chat = createChatStore(
      ws as Parameters<typeof createChatStore>[0],
      createFakeHttp() as Parameters<typeof createChatStore>[1],
    );

    await chat.openSession("session-1");
    await chat.sendMessage("Testing 1 2 3");

    expect(ws.sessionGet).toHaveBeenCalledTimes(2);
    expect(
      chat
        .getSnapshot()
        .active.session?.transcript.filter((item) => item.kind === "text")
        .map((item) => ({ role: item.role, content: item.content })),
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "user", content: "Testing 1 2 3" },
      { role: "assistant", content: "Testing received. How can I help?" },
    ]);
  });

  it("keeps the current transcript when the post-send refresh fails", async () => {
    const ws = createFakeWs();
    ws.sessionGet
      .mockResolvedValueOnce({ session: sampleGetSession("session-1") })
      .mockRejectedValueOnce(new Error("refresh failed"));
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const chat = createChatStore(
      ws as Parameters<typeof createChatStore>[0],
      createFakeHttp() as Parameters<typeof createChatStore>[1],
    );

    await chat.openSession("session-1");
    await chat.sendMessage("follow up");

    expect(ws.sessionGet).toHaveBeenCalledTimes(2);
    expect(chat.getSnapshot().send.sending).toBe(false);
    expect(chat.getSnapshot().send.error).toBeNull();
    expect(
      chat
        .getSnapshot()
        .active.session?.transcript.filter((item) => item.kind === "text")
        .map((item) => ({ role: item.role, content: item.content })),
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "user", content: "follow up" },
    ]);
  });
});
