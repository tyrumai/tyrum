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

function sampleListItem(sessionId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
    title: "",
    summary: "",
    turns_count: 0,
    updated_at: updatedAt,
    created_at: updatedAt,
    last_turn: { role: "user", content: "hello" },
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
    turns: [{ role: "user", content: "hello" }],
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
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

describe("chatStore", () => {
  it("defaults to agentId=default", () => {
    const ws = createFakeWs();
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);
    expect(chat.getSnapshot().agentId).toBe("default");
  });

  it("refreshAgents populates the agent list", async () => {
    const ws = createFakeWs();
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.refreshAgents();

    expect(http.agentList.get).toHaveBeenCalledWith({ include_default: true });
    expect(chat.getSnapshot().agents.agents).toEqual([
      {
        agent_id: "default",
        persona: {
          name: "Default",
          description: "Default agent",
          tone: "direct",
          palette: "graphite",
          character: "operator",
        },
      },
    ]);
    expect(chat.getSnapshot().agents.loading).toBe(false);
  });

  it("refreshSessions uses agentId and stores results", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-1")],
      next_cursor: "c1",
    });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.refreshSessions();

    expect(ws.sessionList).toHaveBeenCalledWith({ agent_id: "default", channel: "ui", limit: 50 });
    expect(chat.getSnapshot().sessions.sessions).toHaveLength(1);
    expect(chat.getSnapshot().sessions.nextCursor).toBe("c1");
    expect(chat.getSnapshot().sessions.loading).toBe(false);
  });

  it("openSession loads the transcript", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-9") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-9");

    expect(ws.sessionGet).toHaveBeenCalledWith({ agent_id: "default", session_id: "session-9" });
    expect(chat.getSnapshot().active.session?.session_id).toBe("session-9");
    expect(chat.getSnapshot().active.loading).toBe(false);
  });

  it("setAgentId clears sessions and active selection", async () => {
    const ws = createFakeWs();
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-1")],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.refreshSessions();
    await chat.openSession("session-1");

    chat.setAgentId("agent-2");

    const snapshot = chat.getSnapshot();
    expect(snapshot.agentId).toBe("agent-2");
    expect(snapshot.sessions.sessions).toEqual([]);
    expect(snapshot.active.sessionId).toBeNull();
    expect(snapshot.active.session).toBeNull();
  });

  it("ignores stale refreshSessions results after switching agents", async () => {
    const ws = createFakeWs();
    const page = deferred<{ sessions: unknown[]; next_cursor: string | null }>();
    ws.sessionList = vi.fn(async () => await page.promise);

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    const loadP = chat.refreshSessions();
    expect(chat.getSnapshot().sessions.loading).toBe(true);

    chat.setAgentId("agent-2");
    expect(chat.getSnapshot().agentId).toBe("agent-2");
    expect(chat.getSnapshot().sessions.loading).toBe(false);

    page.resolve({ sessions: [sampleListItem("session-1")], next_cursor: null });
    await loadP;

    expect(chat.getSnapshot().sessions.sessions).toEqual([]);
  });

  it("loadMoreSessions appends results and advances the cursor", async () => {
    const ws = createFakeWs();
    const itemA = sampleListItem("session-a");
    const itemB = sampleListItem("session-b");
    ws.sessionList
      .mockResolvedValueOnce({ sessions: [itemA], next_cursor: "c1" })
      .mockResolvedValueOnce({ sessions: [itemB], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.refreshSessions();
    expect(chat.getSnapshot().sessions.nextCursor).toBe("c1");

    await chat.loadMoreSessions();

    expect(ws.sessionList).toHaveBeenLastCalledWith({
      agent_id: "default",
      channel: "ui",
      limit: 50,
      cursor: "c1",
    });
    expect(chat.getSnapshot().sessions.sessions.map((s) => s.session_id)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(chat.getSnapshot().sessions.nextCursor).toBeNull();
  });

  it("newChat creates a session then refreshes and opens it", async () => {
    const ws = createFakeWs();
    ws.sessionCreate.mockResolvedValueOnce({
      session_id: "session-9",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-9",
      title: "",
    });
    ws.sessionList.mockResolvedValueOnce({
      sessions: [sampleListItem("session-9")],
      next_cursor: null,
    });
    ws.sessionGet.mockResolvedValueOnce({ session: sampleGetSession("session-9") });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.newChat();

    expect(ws.sessionCreate).toHaveBeenCalledWith({ agent_id: "default", channel: "ui" });
    expect(chat.getSnapshot().active.sessionId).toBe("session-9");
    expect(chat.getSnapshot().active.session?.thread_id).toBe("ui-session-9");
  });

  it("sendMessage sends into the active session", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");
    await chat.sendMessage("hello");

    expect(ws.sessionSend).toHaveBeenCalledWith({
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      content: "hello",
    });
    expect(chat.getSnapshot().send.sending).toBe(false);
    expect(chat.getSnapshot().send.error).toBeNull();
  });

  it("sendMessage forwards the attached node id when provided", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");
    await chat.sendMessage("hello", { attachedNodeId: "node-desktop-1" });

    expect(ws.sessionSend).toHaveBeenCalledWith({
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      content: "hello",
      attached_node_id: "node-desktop-1",
    });
  });

  it("does not reopen the old session after switching agents mid-send", async () => {
    const send = deferred<{ session_id: string; assistant_message: string }>();
    const ws = createFakeWs();
    ws.sessionSend = vi.fn(async () => await send.promise);
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");
    expect(ws.sessionGet).toHaveBeenCalledTimes(1);

    const sendP = chat.sendMessage("hello");
    expect(chat.getSnapshot().send.sending).toBe(true);

    chat.setAgentId("agent-2");
    expect(chat.getSnapshot().agentId).toBe("agent-2");
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(chat.getSnapshot().send.sending).toBe(false);

    send.resolve({ session_id: "session-1", assistant_message: "" });
    await sendP;

    expect(chat.getSnapshot().agentId).toBe("agent-2");
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(ws.sessionGet).toHaveBeenCalledTimes(1);
  });

  it("does not open a new session after switching agents mid-newChat", async () => {
    const create = deferred<{
      session_id: string;
      agent_id: string;
      channel: string;
      thread_id: string;
      title: string;
    }>();

    const ws = createFakeWs();
    ws.sessionCreate = vi.fn(async () => await create.promise);

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    const newChatP = chat.newChat();
    chat.setAgentId("agent-2");

    create.resolve({
      session_id: "session-9",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-9",
      title: "",
    });
    await newChatP;

    expect(chat.getSnapshot().agentId).toBe("agent-2");
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(ws.sessionGet).not.toHaveBeenCalled();
    expect(ws.sessionList).not.toHaveBeenCalled();
  });

  it("compactActive compacts then reloads the transcript", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");
    await chat.compactActive({ keepLastMessages: 5 });

    expect(ws.sessionCompact).toHaveBeenCalledWith({
      agent_id: "default",
      session_id: "session-1",
      keep_last_messages: 5,
    });
  });

  it("deleteActive deletes the session and clears selection", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    ws.sessionList.mockResolvedValue({ sessions: [], next_cursor: null });

    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");
    await chat.deleteActive();

    expect(ws.sessionDelete).toHaveBeenCalledWith({ agent_id: "default", session_id: "session-1" });
    expect(chat.getSnapshot().active.sessionId).toBeNull();
    expect(chat.getSnapshot().active.session).toBeNull();
  });
});
