import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function sampleListItem(sessionId: string, updatedAt = "2026-01-01T00:00:00.000Z") {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
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
      get: vi.fn(async () => ({ agents: [{ agent_id: "default" }] })),
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
    expect(chat.getSnapshot().agents.agents).toEqual([{ agent_id: "default" }]);
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
});
