import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

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
        kind: "text",
        id: `${sessionId}-user-1`,
        role: "user",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

function createFakeWs() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
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
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn(),
    emit: (event: string, data: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(data);
      }
    },
  };
}

function createFakeHttp() {
  return {
    agentList: {
      get: vi.fn(async () => ({
        agents: [
          {
            agent_key: "default",
            persona: {
              name: "Default",
              description: "Default agent",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            },
          },
        ],
      })),
    },
  };
}

describe("chatStore event handling", () => {
  it("matches typing events by thread id when session ids are absent", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("typing.started", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        thread_id: "ui-session-1",
      },
    });
    expect(chat.getSnapshot().active.typing).toBe(true);

    ws.emit("typing.stopped", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        thread_id: "ui-session-1",
      },
    });
    expect(chat.getSnapshot().active.typing).toBe(false);
  });

  it("removes streamed assistant partials when the session send fails", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("reasoning.delta", {
      occurred_at: "2026-01-01T00:00:00.500Z",
      payload: {
        thread_id: "ui-session-1",
        reasoning_id: "reason-1",
        delta: "Think",
      },
    });
    ws.emit("message.delta", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        thread_id: "ui-session-1",
        message_id: "assistant-1",
        role: "assistant",
        delta: "Hello",
      },
    });

    expect(chat.getSnapshot().active.session?.transcript.map((item) => item.id)).toEqual([
      "session-1-user-1",
      "reason-1",
      "assistant-1",
    ]);

    ws.emit("session.send.failed", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        thread_id: "ui-session-1",
        message_ids: ["assistant-1"],
        reasoning_ids: ["reason-1"],
      },
    });

    expect(chat.getSnapshot().active.session?.transcript).toEqual([
      {
        kind: "text",
        id: "session-1-user-1",
        role: "user",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});
