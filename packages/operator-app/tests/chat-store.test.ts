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
    archived: false,
  };
}

function sampleGetSession(sessionId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    ...sampleListItem(sessionId, updatedAt),
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
    sessionArchive: vi.fn(async (payload: { session_id: string; archived: boolean }) => ({
      session_id: payload.session_id,
      archived: payload.archived,
    })),
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
          case "chat.session.archive":
            result = await api.sessionArchive(payload as { session_id: string; archived: boolean });
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

  it("opens a session and stores the full active transcript", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-9") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.openSession("session-9");

    expect(chat.getSnapshot().active.sessionId).toBe("session-9");
    expect(chat.getSnapshot().active.session).toEqual(sampleGetSession("session-9"));
  });

  it("keeps opened archived sessions in the archived list and updates them there", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    try {
      const ws = createFakeWs();
      const archivedItem = { ...sampleListItem("session-1"), archived: true };
      const archivedSession = { ...sampleGetSession("session-1"), archived: true };
      ws.sessionList
        .mockResolvedValueOnce({ sessions: [], next_cursor: null })
        .mockResolvedValueOnce({ sessions: [archivedItem], next_cursor: null });
      ws.sessionGet.mockResolvedValueOnce({ session: archivedSession });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshSessions();
      await chat.loadArchivedSessions();
      await chat.openSession("session-1");

      expect(chat.getSnapshot().sessions.sessions).toEqual([]);
      expect(chat.getSnapshot().archivedSessions.sessions[0]).toEqual(archivedItem);

      chat.updateActiveMessages([
        ...archivedSession.messages,
        {
          id: "session-1-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Archived update" }],
        },
      ]);

      const snapshot = chat.getSnapshot();
      expect(snapshot.active.session?.archived).toBe(true);
      expect(snapshot.sessions.sessions).toEqual([]);
      expect(snapshot.archivedSessions.sessions[0]).toEqual(
        expect.objectContaining({
          session_id: "session-1",
          archived: true,
          message_count: 2,
          last_message: {
            role: "assistant",
            text: "Archived update",
          },
          updated_at: "2026-01-10T00:00:00.000Z",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps existing thread order when opening an older session", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [
        sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
        sampleListItem("session-2", "2026-01-01T00:00:00.000Z"),
      ],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({
      session: sampleGetSession("session-2", "2026-01-01T00:00:00.000Z"),
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.refreshSessions();
    await chat.openSession("session-2");

    expect(chat.getSnapshot().sessions.sessions.map((session) => session.session_id)).toEqual([
      "session-1",
      "session-2",
    ]);
    expect(chat.getSnapshot().active.sessionId).toBe("session-2");
  });

  it("ignores unchanged message arrays so activity order does not reset on open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    try {
      const ws = createFakeWs();
      ws.sessionList.mockResolvedValueOnce({
        sessions: [
          sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
          sampleListItem("session-2", "2026-01-01T00:00:00.000Z"),
        ],
        next_cursor: null,
      });
      ws.sessionGet.mockResolvedValueOnce({
        session: sampleGetSession("session-2", "2026-01-01T00:00:00.000Z"),
      });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshSessions();
      await chat.openSession("session-2");
      chat.updateActiveMessages(sampleGetSession("session-2", "2026-01-01T00:00:00.000Z").messages);

      const snapshot = chat.getSnapshot();
      expect(snapshot.active.session?.updated_at).toBe("2026-01-01T00:00:00.000Z");
      expect(snapshot.sessions.sessions.map((session) => session.session_id)).toEqual([
        "session-1",
        "session-2",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("promotes the active session when live messages actually change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    try {
      const ws = createFakeWs();
      ws.sessionList.mockResolvedValueOnce({
        sessions: [
          sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
          sampleListItem("session-3", "2026-01-01T00:00:00.000Z"),
        ],
        next_cursor: null,
      });
      ws.sessionGet.mockResolvedValueOnce({
        session: sampleGetSession("session-3", "2026-01-01T00:00:00.000Z"),
      });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshSessions();
      await chat.openSession("session-3");
      chat.updateActiveMessages([
        {
          id: "session-3-user-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "session-3-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Fresh assistant reply" }],
        },
      ]);

      const snapshot = chat.getSnapshot();
      expect(snapshot.active.session?.messages).toHaveLength(2);
      expect(snapshot.active.session?.last_message).toEqual({
        role: "assistant",
        text: "Fresh assistant reply",
      });
      expect(snapshot.active.session?.updated_at).toBe("2026-01-10T00:00:00.000Z");
      expect(snapshot.sessions.sessions.map((session) => session.session_id)).toEqual([
        "session-3",
        "session-1",
      ]);
      expect(snapshot.sessions.sessions[0]).toEqual(
        expect.objectContaining({
          session_id: "session-3",
          message_count: 2,
          last_message: {
            role: "assistant",
            text: "Fresh assistant reply",
          },
          updated_at: "2026-01-10T00:00:00.000Z",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates and deletes sessions while retaining live message state", async () => {
    const ws = createFakeWs();
    ws.sessionCreate.mockResolvedValueOnce(sampleGetSession("session-4"));
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.newChat();
    expect(chat.getSnapshot().active.session).toEqual(sampleGetSession("session-4"));
    expect(chat.getSnapshot().sessions.sessions[0]).toEqual(sampleListItem("session-4"));

    await chat.deleteActive();
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(chat.getSnapshot().active.session).toBeNull();
  });

  it("archives a session and removes it from the active list", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-1"), sampleListItem("session-2")],
      next_cursor: null,
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshSessions();

    await chat.archiveSession("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.sessions.sessions.map((s) => s.session_id)).toEqual(["session-2"]);
  });

  it("archives the active session and deselects it", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-1")],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-1") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshSessions();
    await chat.openSession("session-1");

    await chat.archiveSession("session-1");

    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(chat.getSnapshot().active.session).toBeNull();
  });

  it("prepends to archived list when archive section is loaded", async () => {
    const ws = createFakeWs();
    ws.sessionList
      .mockResolvedValueOnce({
        sessions: [sampleListItem("session-1")],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        sessions: [],
        next_cursor: null,
      });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshSessions();
    await chat.loadArchivedSessions();

    await chat.archiveSession("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedSessions.sessions).toHaveLength(1);
    expect(snapshot.archivedSessions.sessions[0]?.session_id).toBe("session-1");
    expect(snapshot.archivedSessions.sessions[0]?.archived).toBe(true);
  });

  it("unarchives a session and moves it to the active list", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-1"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ sessions: [], next_cursor: null })
      .mockResolvedValueOnce({ sessions: [archivedItem], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshSessions();
    await chat.loadArchivedSessions();

    await chat.unarchiveSession("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedSessions.sessions).toHaveLength(0);
    expect(snapshot.sessions.sessions).toHaveLength(1);
    expect(snapshot.sessions.sessions[0]?.session_id).toBe("session-1");
    expect(snapshot.sessions.sessions[0]?.archived).toBe(false);
  });

  it("loads archived sessions lazily", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-a"), archived: true };
    ws.sessionList.mockResolvedValueOnce({ sessions: [archivedItem], next_cursor: "ac1" });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    expect(chat.getSnapshot().archivedSessions.loaded).toBe(false);

    await chat.loadArchivedSessions();

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedSessions.loaded).toBe(true);
    expect(snapshot.archivedSessions.sessions).toEqual([archivedItem]);
    expect(snapshot.archivedSessions.nextCursor).toBe("ac1");
  });

  it("loads more archived sessions with cursor pagination", async () => {
    const ws = createFakeWs();
    const first = { ...sampleListItem("session-a"), archived: true };
    const second = { ...sampleListItem("session-b"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ sessions: [first], next_cursor: "ac1" })
      .mockResolvedValueOnce({ sessions: [second], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.loadArchivedSessions();
    await chat.loadMoreArchivedSessions();

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedSessions.sessions).toEqual([first, second]);
    expect(snapshot.archivedSessions.nextCursor).toBeNull();
  });

  it("resets archived sessions when agent changes", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-a"), archived: true };
    ws.sessionList.mockResolvedValueOnce({ sessions: [archivedItem], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.loadArchivedSessions();
    expect(chat.getSnapshot().archivedSessions.loaded).toBe(true);

    chat.setAgentId("other-agent");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedSessions.loaded).toBe(false);
    expect(snapshot.archivedSessions.sessions).toEqual([]);
  });

  it("removes deleted session from archived list", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-1"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ sessions: [], next_cursor: null })
      .mockResolvedValueOnce({ sessions: [archivedItem], next_cursor: null });
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-1") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshSessions();
    await chat.loadArchivedSessions();
    await chat.openSession("session-1");

    await chat.deleteActive();

    expect(chat.getSnapshot().archivedSessions.sessions).toHaveLength(0);
  });
});
