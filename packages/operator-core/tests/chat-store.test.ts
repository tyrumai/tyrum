import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function sampleListItem(sessionId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
    title: "",
    message_count: 1,
    last_message: { role: "user" as const, text: "hello" },
    updated_at: updatedAt,
    created_at: updatedAt,
  };
}

function sampleGetSession(sessionId: string) {
  return {
    ...sampleListItem(sessionId),
    messages: [
      {
        id: `${sessionId}-user-1`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hello" }],
      },
    ],
  };
}

function createFakeWs() {
  const api = {
    connected: true,
    sessionList: vi.fn(async () => ({ sessions: [], next_cursor: null })),
    sessionGet: vi.fn(async () => ({ session: sampleGetSession("session-1") })),
    sessionCreate: vi.fn(async () => sampleGetSession("session-1")),
    sessionDelete: vi.fn(async () => ({ session_id: "session-1" })),
    requestDynamic: vi.fn(
      async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
        let result: unknown;
        switch (type) {
          case "chat.session.list":
            result = await api.sessionList(payload);
            break;
          case "chat.session.get":
            result = await api.sessionGet(payload);
            break;
          case "chat.session.create":
            result = { session: await api.sessionCreate(payload) };
            break;
          case "chat.session.delete":
            result = await api.sessionDelete(payload);
            break;
          default:
            throw new Error(`unsupported dynamic request: ${type}`);
        }
        return schema?.parse ? schema.parse(result) : result;
      },
    ),
    onDynamicEvent: vi.fn(),
    offDynamicEvent: vi.fn(),
  };
  return api;
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

describe("chatStore", () => {
  it("refreshes session summaries through the AI SDK socket", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-1")],
      next_cursor: "c1",
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.refreshSessions();

    expect(chat.getSnapshot().sessions.sessions).toEqual([sampleListItem("session-1")]);
    expect(chat.getSnapshot().sessions.nextCursor).toBe("c1");
    expect(ws.requestDynamic).toHaveBeenCalled();
  });

  it("opens a session but stores metadata only in active state", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-9") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.openSession("session-9");

    expect(chat.getSnapshot().active.sessionId).toBe("session-9");
    expect(chat.getSnapshot().active.session).toEqual(sampleListItem("session-9"));
  });

  it("creates and deletes sessions without owning live message state", async () => {
    const ws = createFakeWs();
    ws.sessionCreate.mockResolvedValueOnce(sampleGetSession("session-4"));
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.newChat();
    expect(chat.getSnapshot().active.session).toEqual(sampleListItem("session-4"));
    expect(chat.getSnapshot().sessions.sessions[0]).toEqual(sampleListItem("session-4"));

    await chat.deleteActive();
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(chat.getSnapshot().active.session).toBeNull();
  });
});
