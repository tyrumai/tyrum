import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function sampleListItem(conversationId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    conversation_id: conversationId,
    agent_key: "default",
    channel: "ui",
    thread_id: `ui-${conversationId}`,
    title: "",
    message_count: 1,
    last_message: { role: "user" as const, text: "hello" },
    updated_at: updatedAt,
    created_at: updatedAt,
    archived: false,
  };
}

function sampleGetSession(conversationId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    ...sampleListItem(conversationId, updatedAt),
    queue_mode: "steer" as const,
    messages: [
      {
        id: `${conversationId}-user-1`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hello" }],
      },
    ],
  };
}

function createFakeWs() {
  const api = {
    connected: true,
    sessionList: vi.fn(async () => ({ conversations: [], next_cursor: null })),
    sessionGet: vi.fn(async () => ({ conversation: sampleGetSession("session-1") })),
    sessionCreate: vi.fn(async () => sampleGetSession("session-1")),
    sessionDelete: vi.fn(async () => ({ conversation_id: "session-1" })),
    sessionQueueModeSet: vi.fn(
      async (payload: { queue_mode: string; conversation_id: string }) => ({
        conversation_id: payload.conversation_id,
        queue_mode: payload.queue_mode,
      }),
    ),
    sessionArchive: vi.fn(async (payload: { conversation_id: string; archived: boolean }) => ({
      conversation_id: payload.conversation_id,
      archived: payload.archived,
    })),
    requestDynamic: vi.fn(
      async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
        let result: unknown;
        switch (type) {
          case "conversation.list":
            result = await api.sessionList(payload);
            break;
          case "conversation.get":
            result = await api.sessionGet(payload);
            break;
          case "conversation.create":
            result = { conversation: await api.sessionCreate(payload) };
            break;
          case "conversation.delete":
            result = await api.sessionDelete(payload);
            break;
          case "conversation.queue_mode.set":
            result = await api.sessionQueueModeSet(
              payload as { queue_mode: string; conversation_id: string },
            );
            break;
          case "conversation.archive":
            result = await api.sessionArchive(
              payload as { conversation_id: string; archived: boolean },
            );
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
      conversations: [sampleListItem("session-1")],
      next_cursor: "c1",
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.refreshConversations();

    expect(chat.getSnapshot().conversations.conversations).toEqual([sampleListItem("session-1")]);
    expect(chat.getSnapshot().conversations.nextCursor).toBe("c1");
    expect(ws.requestDynamic).toHaveBeenCalled();
  });

  it("opens a session and stores the full active transcript", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValueOnce({ conversation: sampleGetSession("session-9") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.openConversation("session-9");

    expect(chat.getSnapshot().active.conversationId).toBe("session-9");
    expect(chat.getSnapshot().active.conversation).toEqual(sampleGetSession("session-9"));
  });

  it("keeps opened archived conversations in the archived list and updates them there", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    try {
      const ws = createFakeWs();
      const archivedItem = { ...sampleListItem("session-1"), archived: true };
      const archivedSession = { ...sampleGetSession("session-1"), archived: true };
      ws.sessionList
        .mockResolvedValueOnce({ conversations: [], next_cursor: null })
        .mockResolvedValueOnce({ conversations: [archivedItem], next_cursor: null });
      ws.sessionGet.mockResolvedValueOnce({ conversation: archivedSession });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshConversations();
      await chat.loadArchivedConversations();
      await chat.openConversation("session-1");

      expect(chat.getSnapshot().conversations.conversations).toEqual([]);
      expect(chat.getSnapshot().archivedConversations.conversations[0]).toEqual(archivedItem);

      chat.updateActiveMessages([
        ...archivedSession.messages,
        {
          id: "session-1-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Archived update" }],
        },
      ]);

      const snapshot = chat.getSnapshot();
      expect(snapshot.active.conversation?.archived).toBe(true);
      expect(snapshot.conversations.conversations).toEqual([]);
      expect(snapshot.archivedConversations.conversations[0]).toEqual(
        expect.objectContaining({
          conversation_id: "session-1",
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
      conversations: [
        sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
        sampleListItem("session-2", "2026-01-01T00:00:00.000Z"),
      ],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({
      conversation: sampleGetSession("session-2", "2026-01-01T00:00:00.000Z"),
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.refreshConversations();
    await chat.openConversation("session-2");

    expect(
      chat.getSnapshot().conversations.conversations.map((session) => session.conversation_id),
    ).toEqual(["session-1", "session-2"]);
    expect(chat.getSnapshot().active.conversationId).toBe("session-2");
  });

  it("ignores unchanged message arrays so activity order does not reset on open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    try {
      const ws = createFakeWs();
      ws.sessionList.mockResolvedValueOnce({
        conversations: [
          sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
          sampleListItem("session-2", "2026-01-01T00:00:00.000Z"),
        ],
        next_cursor: null,
      });
      ws.sessionGet.mockResolvedValueOnce({
        conversation: sampleGetSession("session-2", "2026-01-01T00:00:00.000Z"),
      });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshConversations();
      await chat.openConversation("session-2");
      chat.updateActiveMessages(sampleGetSession("session-2", "2026-01-01T00:00:00.000Z").messages);

      const snapshot = chat.getSnapshot();
      expect(snapshot.active.conversation?.updated_at).toBe("2026-01-01T00:00:00.000Z");
      expect(
        snapshot.conversations.conversations.map((session) => session.conversation_id),
      ).toEqual(["session-1", "session-2"]);
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
        conversations: [
          sampleListItem("session-1", "2026-01-02T00:00:00.000Z"),
          sampleListItem("session-3", "2026-01-01T00:00:00.000Z"),
        ],
        next_cursor: null,
      });
      ws.sessionGet.mockResolvedValueOnce({
        conversation: sampleGetSession("session-3", "2026-01-01T00:00:00.000Z"),
      });
      const chat = createChatStore(ws as never, createFakeHttp() as never);

      await chat.refreshConversations();
      await chat.openConversation("session-3");
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
      expect(snapshot.active.conversation?.messages).toHaveLength(2);
      expect(snapshot.active.conversation?.last_message).toEqual({
        role: "assistant",
        text: "Fresh assistant reply",
      });
      expect(snapshot.active.conversation?.updated_at).toBe("2026-01-10T00:00:00.000Z");
      expect(
        snapshot.conversations.conversations.map((session) => session.conversation_id),
      ).toEqual(["session-3", "session-1"]);
      expect(snapshot.conversations.conversations[0]).toEqual(
        expect.objectContaining({
          conversation_id: "session-3",
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

  it("creates and deletes conversations while retaining live message state", async () => {
    const ws = createFakeWs();
    ws.sessionCreate.mockResolvedValueOnce(sampleGetSession("session-4"));
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.newChat();
    expect(chat.getSnapshot().active.conversation).toEqual(sampleGetSession("session-4"));
    expect(chat.getSnapshot().conversations.conversations[0]).toEqual(sampleListItem("session-4"));

    await chat.deleteActive();
    expect(chat.getSnapshot().active.conversationId).toBeNull();
    expect(chat.getSnapshot().active.conversation).toBeNull();
  });

  it("archives a session and removes it from the active list", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      conversations: [sampleListItem("session-1"), sampleListItem("session-2")],
      next_cursor: null,
    });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshConversations();

    await chat.archiveConversation("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.conversations.conversations.map((s) => s.conversation_id)).toEqual([
      "session-2",
    ]);
  });

  it("archives the active session and deselects it", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      conversations: [sampleListItem("session-1")],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({ conversation: sampleGetSession("session-1") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshConversations();
    await chat.openConversation("session-1");

    await chat.archiveConversation("session-1");

    expect(chat.getSnapshot().active.conversationId).toBeNull();
    expect(chat.getSnapshot().active.conversation).toBeNull();
  });

  it("prepends to archived list when archive section is loaded", async () => {
    const ws = createFakeWs();
    ws.sessionList
      .mockResolvedValueOnce({
        conversations: [sampleListItem("session-1")],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        conversations: [],
        next_cursor: null,
      });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshConversations();
    await chat.loadArchivedConversations();

    await chat.archiveConversation("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedConversations.conversations).toHaveLength(1);
    expect(snapshot.archivedConversations.conversations[0]?.conversation_id).toBe("session-1");
    expect(snapshot.archivedConversations.conversations[0]?.archived).toBe(true);
  });

  it("unarchives a session and moves it to the active list", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-1"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ conversations: [], next_cursor: null })
      .mockResolvedValueOnce({ conversations: [archivedItem], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshConversations();
    await chat.loadArchivedConversations();

    await chat.unarchiveConversation("session-1");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedConversations.conversations).toHaveLength(0);
    expect(snapshot.conversations.conversations).toHaveLength(1);
    expect(snapshot.conversations.conversations[0]?.conversation_id).toBe("session-1");
    expect(snapshot.conversations.conversations[0]?.archived).toBe(false);
  });

  it("loads archived conversations lazily", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-a"), archived: true };
    ws.sessionList.mockResolvedValueOnce({ conversations: [archivedItem], next_cursor: "ac1" });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    expect(chat.getSnapshot().archivedConversations.loaded).toBe(false);

    await chat.loadArchivedConversations();

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedConversations.loaded).toBe(true);
    expect(snapshot.archivedConversations.conversations).toEqual([archivedItem]);
    expect(snapshot.archivedConversations.nextCursor).toBe("ac1");
  });

  it("omits empty agent_key when loading archived conversations", async () => {
    const ws = createFakeWs();
    ws.sessionList
      .mockResolvedValueOnce({ conversations: [sampleListItem("session-a")], next_cursor: "ac1" })
      .mockResolvedValueOnce({ conversations: [sampleListItem("session-b")], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.loadArchivedConversations();
    await chat.loadMoreArchivedConversations();

    expect(ws.sessionList).toHaveBeenNthCalledWith(1, {
      channel: "ui",
      archived: true,
      limit: 50,
    });
    expect(ws.sessionList).toHaveBeenNthCalledWith(2, {
      channel: "ui",
      archived: true,
      limit: 50,
      cursor: "ac1",
    });
  });

  it("loads more archived conversations with cursor pagination", async () => {
    const ws = createFakeWs();
    const first = { ...sampleListItem("session-a"), archived: true };
    const second = { ...sampleListItem("session-b"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ conversations: [first], next_cursor: "ac1" })
      .mockResolvedValueOnce({ conversations: [second], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.loadArchivedConversations();
    await chat.loadMoreArchivedConversations();

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedConversations.conversations).toEqual([first, second]);
    expect(snapshot.archivedConversations.nextCursor).toBeNull();
  });

  it("resets archived conversations when agent changes", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-a"), archived: true };
    ws.sessionList.mockResolvedValueOnce({ conversations: [archivedItem], next_cursor: null });
    const chat = createChatStore(ws as never, createFakeHttp() as never);

    await chat.loadArchivedConversations();
    expect(chat.getSnapshot().archivedConversations.loaded).toBe(true);

    chat.setAgentKey("other-agent");

    const snapshot = chat.getSnapshot();
    expect(snapshot.archivedConversations.loaded).toBe(false);
    expect(snapshot.archivedConversations.conversations).toEqual([]);
  });

  it("removes deleted session from archived list", async () => {
    const ws = createFakeWs();
    const archivedItem = { ...sampleListItem("session-1"), archived: true };
    ws.sessionList
      .mockResolvedValueOnce({ conversations: [], next_cursor: null })
      .mockResolvedValueOnce({ conversations: [archivedItem], next_cursor: null });
    ws.sessionGet.mockResolvedValueOnce({ conversation: sampleGetSession("session-1") });
    const chat = createChatStore(ws as never, createFakeHttp() as never);
    await chat.refreshConversations();
    await chat.loadArchivedConversations();
    await chat.openConversation("session-1");

    await chat.deleteActive();

    expect(chat.getSnapshot().archivedConversations.conversations).toHaveLength(0);
  });
});
