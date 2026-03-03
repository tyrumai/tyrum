import type { WsSessionGetSession, WsSessionListItem } from "@tyrum/client";
import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import { toOperatorCoreError, type OperatorCoreError } from "../operator-error.js";
import { createStore, type ExternalStore } from "../store.js";

export type ChatAgent = {
  agent_id: string;
};

export interface ChatAgentsState {
  agents: ChatAgent[];
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatSessionsState {
  sessions: WsSessionListItem[];
  nextCursor: string | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatActiveSessionState {
  sessionId: string | null;
  session: WsSessionGetSession | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatSendState {
  sending: boolean;
  error: OperatorCoreError | null;
}

export interface ChatState {
  agentId: string;
  agents: ChatAgentsState;
  sessions: ChatSessionsState;
  active: ChatActiveSessionState;
  send: ChatSendState;
}

export interface ChatStore extends ExternalStore<ChatState> {
  setAgentId(agentId: string): void;
  refreshAgents(input?: { includeDefault?: boolean }): Promise<void>;
  refreshSessions(): Promise<void>;
  loadMoreSessions(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  newChat(): Promise<void>;
  sendMessage(content: string): Promise<void>;
  compactActive(input?: { keepLastMessages?: number }): Promise<void>;
  deleteActive(): Promise<void>;
}

export function createChatStore(ws: OperatorWsClient, http: OperatorHttpClient): ChatStore {
  const { store, setState } = createStore<ChatState>({
    agentId: "default",
    agents: {
      agents: [],
      loading: false,
      error: null,
    },
    sessions: {
      sessions: [],
      nextCursor: null,
      loading: false,
      error: null,
    },
    active: {
      sessionId: null,
      session: null,
      loading: false,
      error: null,
    },
    send: {
      sending: false,
      error: null,
    },
  });

  let agentsRunId = 0;
  let sessionsRunId = 0;
  let openRunId = 0;

  function setAgentId(agentId: string): void {
    const nextAgentId = agentId.trim().length > 0 ? agentId.trim() : "default";
    if (store.getSnapshot().agentId === nextAgentId) return;

    // Invalidate any in-flight session loads for the previous agent selection.
    sessionsRunId += 1;
    openRunId += 1;
    setState((prev) => {
      return {
        ...prev,
        agentId: nextAgentId,
        sessions: { sessions: [], nextCursor: null, loading: false, error: null },
        active: { sessionId: null, session: null, loading: false, error: null },
        send: { sending: false, error: null },
      };
    });
  }

  async function refreshAgents(input?: { includeDefault?: boolean }): Promise<void> {
    const runId = ++agentsRunId;
    setState((prev) => ({ ...prev, agents: { ...prev.agents, loading: true, error: null } }));
    try {
      const res = await http.agentList.get({
        include_default: input?.includeDefault ?? true,
      });
      if (runId !== agentsRunId) return;
      setState((prev) => ({
        ...prev,
        agents: {
          agents: res.agents.map((a) => ({ agent_id: a.agent_id })),
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      if (runId !== agentsRunId) return;
      setState((prev) => ({
        ...prev,
        agents: {
          ...prev.agents,
          loading: false,
          error: toOperatorCoreError("http", "agent.list", err),
        },
      }));
    }
  }

  async function refreshSessions(): Promise<void> {
    const runId = ++sessionsRunId;
    setState((prev) => ({
      ...prev,
      sessions: { ...prev.sessions, loading: true, error: null, nextCursor: null },
    }));
    try {
      const agentId = store.getSnapshot().agentId;
      const res = await ws.sessionList({ agent_id: agentId, channel: "ui", limit: 50 });
      if (runId !== sessionsRunId) return;
      setState((prev) => ({
        ...prev,
        sessions: {
          sessions: res.sessions,
          nextCursor: res.next_cursor ?? null,
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      if (runId !== sessionsRunId) return;
      setState((prev) => ({
        ...prev,
        sessions: {
          ...prev.sessions,
          loading: false,
          error: toOperatorCoreError("ws", "session.list", err),
        },
      }));
    }
  }

  async function loadMoreSessions(): Promise<void> {
    const snapshot = store.getSnapshot();
    if (snapshot.sessions.loading) return;
    const cursor = snapshot.sessions.nextCursor;
    if (!cursor) return;

    const runId = ++sessionsRunId;
    setState((prev) => ({ ...prev, sessions: { ...prev.sessions, loading: true, error: null } }));

    try {
      const res = await ws.sessionList({
        agent_id: snapshot.agentId,
        channel: "ui",
        limit: 50,
        cursor,
      });
      if (runId !== sessionsRunId) return;
      setState((prev) => ({
        ...prev,
        sessions: {
          sessions: [...prev.sessions.sessions, ...res.sessions],
          nextCursor: res.next_cursor ?? null,
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      if (runId !== sessionsRunId) return;
      setState((prev) => ({
        ...prev,
        sessions: {
          ...prev.sessions,
          loading: false,
          error: toOperatorCoreError("ws", "session.list", err),
        },
      }));
    }
  }

  async function openSession(sessionId: string): Promise<void> {
    const trimmed = sessionId.trim();
    if (!trimmed) return;

    const runId = ++openRunId;
    setState((prev) => ({
      ...prev,
      active: { ...prev.active, sessionId: trimmed, session: null, loading: true, error: null },
      send: { ...prev.send, error: null },
    }));

    try {
      const agentId = store.getSnapshot().agentId;
      const res = await ws.sessionGet({ agent_id: agentId, session_id: trimmed });
      if (runId !== openRunId) return;
      setState((prev) => ({
        ...prev,
        active: { sessionId: trimmed, session: res.session, loading: false, error: null },
      }));
    } catch (err) {
      if (runId !== openRunId) return;
      setState((prev) => ({
        ...prev,
        active: {
          ...prev.active,
          loading: false,
          error: toOperatorCoreError("ws", "session.get", err),
        },
      }));
    }
  }

  async function newChat(): Promise<void> {
    setState((prev) => ({ ...prev, sessions: { ...prev.sessions, error: null } }));
    try {
      const agentId = store.getSnapshot().agentId;
      const created = await ws.sessionCreate({ agent_id: agentId, channel: "ui" });
      await refreshSessions();
      await openSession(created.session_id);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        sessions: { ...prev.sessions, error: toOperatorCoreError("ws", "session.create", err) },
      }));
    }
  }

  async function sendMessage(content: string): Promise<void> {
    const text = content.trim();
    if (!text) return;

    const snapshot = store.getSnapshot();
    const session = snapshot.active.session;
    if (!session) return;

    setState((prev) => ({ ...prev, send: { sending: true, error: null } }));
    try {
      const agentId = snapshot.agentId;
      const reply = await ws.sessionSend({
        agent_id: agentId,
        channel: session.channel,
        thread_id: session.thread_id,
        content: text,
      });
      void reply;
      await openSession(session.session_id);
      await refreshSessions();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        send: { sending: false, error: toOperatorCoreError("ws", "session.send", err) },
      }));
      return;
    }

    setState((prev) => ({ ...prev, send: { sending: false, error: null } }));
  }

  async function compactActive(input?: { keepLastMessages?: number }): Promise<void> {
    const snapshot = store.getSnapshot();
    const sessionId = snapshot.active.sessionId;
    if (!sessionId) return;

    setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
    try {
      await ws.sessionCompact({
        agent_id: snapshot.agentId,
        session_id: sessionId,
        keep_last_messages: input?.keepLastMessages,
      });
      await openSession(sessionId);
      await refreshSessions();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        active: { ...prev.active, error: toOperatorCoreError("ws", "session.compact", err) },
      }));
    }
  }

  async function deleteActive(): Promise<void> {
    const snapshot = store.getSnapshot();
    const sessionId = snapshot.active.sessionId;
    if (!sessionId) return;

    setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
    try {
      await ws.sessionDelete({ agent_id: snapshot.agentId, session_id: sessionId });
      setState((prev) => ({
        ...prev,
        active: { sessionId: null, session: null, loading: false, error: null },
      }));
      await refreshSessions();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        active: { ...prev.active, error: toOperatorCoreError("ws", "session.delete", err) },
      }));
    }
  }

  return {
    ...store,
    setAgentId,
    refreshAgents,
    refreshSessions,
    loadMoreSessions,
    openSession,
    newChat,
    sendMessage,
    compactActive,
    deleteActive,
  };
}
