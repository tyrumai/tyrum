import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
        user_message_id: "user-pending-1",
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

  it("retracts a user message confirmed before the send eventually fails", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("message.final", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        thread_id: "ui-session-1",
        message_id: "user-pending-1",
        role: "user",
        content: "retry me",
      },
    });

    expect(chat.getSnapshot().active.session?.transcript.map((item) => item.id)).toEqual([
      "session-1-user-1",
      "user-pending-1",
    ]);

    ws.emit("session.send.failed", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        thread_id: "ui-session-1",
        user_message_id: "user-pending-1",
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

  it("lets message.final replace a longer streamed delta for the same message id", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("message.delta", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        thread_id: "ui-session-1",
        message_id: "assistant-1",
        role: "assistant",
        delta: "Hello there",
      },
    });
    ws.emit("message.final", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        thread_id: "ui-session-1",
        message_id: "assistant-1",
        role: "assistant",
        content: "Hello",
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
      {
        kind: "text",
        id: "assistant-1",
        role: "assistant",
        content: "Hello",
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ]);
  });

  it("buffers matching live updates while openSession is still loading", async () => {
    const ws = createFakeWs();
    const pendingGet = deferred<{ session: ReturnType<typeof sampleGetSession> }>();
    ws.sessionGet.mockImplementation(async () => await pendingGet.promise);
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    const openPromise = chat.openSession("session-1");

    expect(chat.getSnapshot().active.loading).toBe(true);
    expect(chat.getSnapshot().active.session).toBeNull();

    ws.emit("typing.started", {
      occurred_at: "2026-01-01T00:00:00.500Z",
      payload: {
        session_id: "session-1",
      },
    });
    ws.emit("tool.lifecycle", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        session_id: "session-1",
        thread_id: "ui-session-1",
        tool_call_id: "tool-1",
        tool_id: "shell.exec",
        status: "awaiting_approval",
        summary: "Waiting for approval",
      },
    });
    ws.emit("approval_request", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        approval_id: "11111111-1111-1111-1111-111111111111",
        approval_key: "approval:11111111-1111-1111-1111-111111111111",
        kind: "other",
        prompt: "Allow shell command?",
        context: {
          session_id: "session-1",
          thread_id: "ui-session-1",
          tool_call_id: "tool-1",
        },
      },
    });
    ws.emit("message.delta", {
      occurred_at: "2026-01-01T00:00:03.000Z",
      payload: {
        session_id: "session-1",
        thread_id: "ui-session-1",
        message_id: "assistant-1",
        role: "assistant",
        delta: "Working on it",
      },
    });

    pendingGet.resolve({ session: sampleGetSession("session-1") });
    await openPromise;

    expect(chat.getSnapshot().active.typing).toBe(true);
    expect(chat.getSnapshot().active.activeToolCallIds).toEqual(["tool-1"]);
    expect(chat.getSnapshot().active.session?.transcript).toEqual([
      {
        kind: "text",
        id: "session-1-user-1",
        role: "user",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        kind: "tool",
        id: "tool-1",
        tool_id: "shell.exec",
        tool_call_id: "tool-1",
        status: "awaiting_approval",
        summary: "Waiting for approval",
        created_at: "2026-01-01T00:00:01.000Z",
        updated_at: "2026-01-01T00:00:01.000Z",
        thread_id: "ui-session-1",
      },
      {
        kind: "approval",
        id: "11111111-1111-1111-1111-111111111111",
        approval_id: "11111111-1111-1111-1111-111111111111",
        tool_call_id: "tool-1",
        status: "pending",
        title: "Approval required",
        detail: "Allow shell command?",
        created_at: "2026-01-01T00:00:02.000Z",
        updated_at: "2026-01-01T00:00:02.000Z",
      },
      {
        kind: "text",
        id: "assistant-1",
        role: "assistant",
        content: "Working on it",
        created_at: "2026-01-01T00:00:03.000Z",
      },
    ]);
  });
});
