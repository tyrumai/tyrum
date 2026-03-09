import type { WsSessionGetSession, WsSessionListItem } from "@tyrum/client";
import type { AgentPersona } from "@tyrum/schemas";
import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import { toOperatorCoreError, type OperatorCoreError } from "../operator-error.js";
import { createStore, type ExternalStore } from "../store.js";

export type ChatAgent = {
  agent_id: string;
  persona?: AgentPersona;
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
  sendMessage(content: string, input?: { attachedNodeId?: string | null }): Promise<void>;
  compactActive(input?: { keepLastMessages?: number }): Promise<void>;
  deleteActive(): Promise<void>;
}

type ChatStoreRunIds = {
  agents: number;
  sessions: number;
  open: number;
  send: number;
};

type ChatStoreContext = {
  store: ExternalStore<ChatState>;
  setState: (updater: (prev: ChatState) => ChatState) => void;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  runIds: ChatStoreRunIds;
};

function normalizeAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

function setAgentIdImpl(ctx: ChatStoreContext, agentId: string): void {
  const nextAgentId = normalizeAgentId(agentId);
  if (ctx.store.getSnapshot().agentId === nextAgentId) return;

  // Invalidate any in-flight session loads for the previous agent selection.
  ctx.runIds.sessions += 1;
  ctx.runIds.open += 1;
  ctx.runIds.send += 1;
  ctx.setState((prev) => ({
    ...prev,
    agentId: nextAgentId,
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    active: { sessionId: null, session: null, loading: false, error: null },
    send: { sending: false, error: null },
  }));
}

async function refreshAgentsImpl(
  ctx: ChatStoreContext,
  input?: { includeDefault?: boolean },
): Promise<void> {
  const runId = ++ctx.runIds.agents;
  ctx.setState((prev) => ({ ...prev, agents: { ...prev.agents, loading: true, error: null } }));
  try {
    const res = await ctx.http.agentList.get({
      include_default: input?.includeDefault ?? true,
    });
    if (runId !== ctx.runIds.agents) return;
    ctx.setState((prev) => ({
      ...prev,
      agents: {
        agents: res.agents.map((agent) => ({
          agent_id: agent.agent_key,
          persona: agent.persona,
        })),
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.agents) return;
    ctx.setState((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        loading: false,
        error: toOperatorCoreError("http", "agent.list", err),
      },
    }));
  }
}

async function refreshSessionsImpl(ctx: ChatStoreContext): Promise<void> {
  const runId = ++ctx.runIds.sessions;
  ctx.setState((prev) => ({
    ...prev,
    sessions: { ...prev.sessions, loading: true, error: null, nextCursor: null },
  }));
  try {
    const agentId = ctx.store.getSnapshot().agentId;
    const res = await ctx.ws.sessionList({ agent_id: agentId, channel: "ui", limit: 50 });
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        sessions: res.sessions,
        nextCursor: res.next_cursor ?? null,
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        loading: false,
        error: toOperatorCoreError("ws", "session.list", err),
      },
    }));
  }
}

async function loadMoreSessionsImpl(ctx: ChatStoreContext): Promise<void> {
  const snapshot = ctx.store.getSnapshot();
  if (snapshot.sessions.loading) return;
  const cursor = snapshot.sessions.nextCursor;
  if (!cursor) return;

  const runId = ++ctx.runIds.sessions;
  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, loading: true, error: null } }));

  try {
    const res = await ctx.ws.sessionList({
      agent_id: snapshot.agentId,
      channel: "ui",
      limit: 50,
      cursor,
    });
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        sessions: [...prev.sessions.sessions, ...res.sessions],
        nextCursor: res.next_cursor ?? null,
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        loading: false,
        error: toOperatorCoreError("ws", "session.list", err),
      },
    }));
  }
}

async function openSessionImpl(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const trimmed = sessionId.trim();
  if (!trimmed) return;

  const runId = ++ctx.runIds.open;
  ctx.setState((prev) => ({
    ...prev,
    active: { ...prev.active, sessionId: trimmed, session: null, loading: true, error: null },
    send: { ...prev.send, error: null },
  }));

  try {
    const agentId = ctx.store.getSnapshot().agentId;
    const res = await ctx.ws.sessionGet({ agent_id: agentId, session_id: trimmed });
    if (runId !== ctx.runIds.open) return;
    ctx.setState((prev) => ({
      ...prev,
      active: { sessionId: trimmed, session: res.session, loading: false, error: null },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.open) return;
    ctx.setState((prev) => ({
      ...prev,
      active: {
        ...prev.active,
        loading: false,
        error: toOperatorCoreError("ws", "session.get", err),
      },
    }));
  }
}

async function newChatImpl(ctx: ChatStoreContext): Promise<void> {
  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, error: null } }));
  const expectedAgentId = ctx.store.getSnapshot().agentId;
  try {
    const created = await ctx.ws.sessionCreate({ agent_id: expectedAgentId, channel: "ui" });
    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;
    await refreshSessionsImpl(ctx);
    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;
    await openSessionImpl(ctx, created.session_id);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: { ...prev.sessions, error: toOperatorCoreError("ws", "session.create", err) },
    }));
  }
}

async function sendMessageImpl(
  ctx: ChatStoreContext,
  content: string,
  input?: { attachedNodeId?: string | null },
): Promise<void> {
  const text = content.trim();
  if (!text) return;

  const snapshot = ctx.store.getSnapshot();
  const session = snapshot.active.session;
  if (!session) return;

  const runId = ++ctx.runIds.send;
  const expectedAgentId = snapshot.agentId;
  const expectedSessionId = session.session_id;

  ctx.setState((prev) => ({ ...prev, send: { sending: true, error: null } }));
  try {
    const reply = await ctx.ws.sessionSend({
      agent_id: expectedAgentId,
      channel: session.channel,
      thread_id: session.thread_id,
      content: text,
      ...(input?.attachedNodeId ? { attached_node_id: input.attachedNodeId } : {}),
    });
    void reply;

    if (runId !== ctx.runIds.send) return;

    const afterSend = ctx.store.getSnapshot();
    if (afterSend.agentId === expectedAgentId && afterSend.active.sessionId === expectedSessionId) {
      await openSessionImpl(ctx, expectedSessionId);
      if (runId !== ctx.runIds.send) return;
    }

    if (ctx.store.getSnapshot().agentId === expectedAgentId) {
      await refreshSessionsImpl(ctx);
    }
  } catch (err) {
    if (runId === ctx.runIds.send) {
      ctx.setState((prev) => ({
        ...prev,
        send: { sending: false, error: toOperatorCoreError("ws", "session.send", err) },
      }));
    }
    return;
  }

  if (runId === ctx.runIds.send) {
    ctx.setState((prev) => ({ ...prev, send: { sending: false, error: null } }));
  }
}

async function compactActiveImpl(
  ctx: ChatStoreContext,
  input?: { keepLastMessages?: number },
): Promise<void> {
  const snapshot = ctx.store.getSnapshot();
  const sessionId = snapshot.active.sessionId;
  if (!sessionId) return;

  ctx.setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
  try {
    const expectedAgentId = snapshot.agentId;
    await ctx.ws.sessionCompact({
      agent_id: expectedAgentId,
      session_id: sessionId,
      keep_last_messages: input?.keepLastMessages,
    });
    const afterCompact = ctx.store.getSnapshot();
    if (afterCompact.agentId !== expectedAgentId) return;

    if (afterCompact.active.sessionId === sessionId) {
      await openSessionImpl(ctx, sessionId);
    }
    await refreshSessionsImpl(ctx);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "session.compact", err) },
    }));
  }
}

async function deleteActiveImpl(ctx: ChatStoreContext): Promise<void> {
  const snapshot = ctx.store.getSnapshot();
  const sessionId = snapshot.active.sessionId;
  if (!sessionId) return;

  ctx.setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
  try {
    const expectedAgentId = snapshot.agentId;
    await ctx.ws.sessionDelete({ agent_id: expectedAgentId, session_id: sessionId });

    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;

    if (ctx.store.getSnapshot().active.sessionId === sessionId) {
      ctx.setState((prev) => ({
        ...prev,
        active: { sessionId: null, session: null, loading: false, error: null },
      }));
    }
    await refreshSessionsImpl(ctx);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "session.delete", err) },
    }));
  }
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

  const ctx: ChatStoreContext = {
    store,
    setState,
    ws,
    http,
    runIds: { agents: 0, sessions: 0, open: 0, send: 0 },
  };

  return {
    ...store,
    setAgentId: (agentId) => setAgentIdImpl(ctx, agentId),
    refreshAgents: (input) => refreshAgentsImpl(ctx, input),
    refreshSessions: () => refreshSessionsImpl(ctx),
    loadMoreSessions: () => loadMoreSessionsImpl(ctx),
    openSession: (sessionId) => openSessionImpl(ctx, sessionId),
    newChat: () => newChatImpl(ctx),
    sendMessage: (content, input) => sendMessageImpl(ctx, content, input),
    compactActive: (input) => compactActiveImpl(ctx, input),
    deleteActive: () => deleteActiveImpl(ctx),
  };
}
