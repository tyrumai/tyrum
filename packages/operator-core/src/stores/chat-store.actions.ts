import {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
  type UIMessage,
} from "@tyrum/client/browser";
import { toOperatorCoreError } from "../operator-error.js";
import type { ChatStoreContext } from "./chat-store.types.js";

function createClientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-local-${String(Date.now())}`;
}

function normalizeAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

function requireChatSocket(ctx: ChatStoreContext) {
  return supportsTyrumAiSdkChatSocket(ctx.ws) ? ctx.ws : null;
}

function buildSessionClient(ctx: ChatStoreContext) {
  const socket = requireChatSocket(ctx);
  return socket ? createTyrumAiSdkChatSessionClient({ client: socket }) : null;
}

function buildTransport(ctx: ChatStoreContext) {
  const socket = requireChatSocket(ctx);
  return socket ? createTyrumAiSdkChatTransport({ client: socket }) : null;
}

async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return;
    }
  }
}

export function setAgentId(ctx: ChatStoreContext, agentId: string): void {
  const nextAgentId = normalizeAgentId(agentId);
  if (ctx.store.getSnapshot().agentId === nextAgentId) return;

  ctx.runIds.sessions += 1;
  ctx.runIds.open += 1;
  ctx.runIds.send += 1;
  ctx.setState((prev) => ({
    ...prev,
    agentId: nextAgentId,
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    active: {
      sessionId: null,
      session: null,
      loading: false,
      typing: false,
      error: null,
    },
    send: { sending: false, error: null },
  }));
}

export async function refreshAgents(
  ctx: ChatStoreContext,
  input?: { includeDefault?: boolean },
): Promise<void> {
  const runId = ++ctx.runIds.sessions;
  ctx.setState((prev) => ({ ...prev, agents: { ...prev.agents, loading: true, error: null } }));
  try {
    const res = await ctx.http.agentList.get({
      include_default: input?.includeDefault ?? true,
    });
    if (runId !== ctx.runIds.sessions) return;
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
    if (runId !== ctx.runIds.sessions) return;
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

export async function refreshSessions(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        loading: false,
        error: toOperatorCoreError(
          "ws",
          "chat.session.list",
          new Error("chat transport unavailable"),
        ),
      },
    }));
    return;
  }

  const runId = ++ctx.runIds.sessions;
  ctx.setState((prev) => ({
    ...prev,
    sessions: { ...prev.sessions, loading: true, error: null, nextCursor: null },
  }));
  try {
    const agentId = ctx.store.getSnapshot().agentId;
    const res = await sessionClient.list({ agent_id: agentId, channel: "ui", limit: 50 });
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
        error: toOperatorCoreError("ws", "chat.session.list", err),
      },
    }));
  }
}

export async function loadMoreSessions(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!sessionClient || snapshot.sessions.loading) return;
  const cursor = snapshot.sessions.nextCursor;
  if (!cursor) return;

  const runId = ++ctx.runIds.sessions;
  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, loading: true, error: null } }));

  try {
    const res = await sessionClient.list({
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
        error: toOperatorCoreError("ws", "chat.session.list", err),
      },
    }));
  }
}

export async function openSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  const trimmed = sessionId.trim();
  if (!sessionClient || !trimmed) return;

  const runId = ++ctx.runIds.open;
  ctx.setState((prev) => ({
    ...prev,
    active: {
      ...prev.active,
      sessionId: trimmed,
      session: null,
      loading: true,
      typing: false,
      error: null,
    },
    send: { ...prev.send, error: null },
  }));

  try {
    const session = await sessionClient.get({ session_id: trimmed });
    if (runId !== ctx.runIds.open) return;
    ctx.setState((prev) => ({
      ...prev,
      active: {
        sessionId: trimmed,
        session,
        loading: false,
        typing: false,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.open) return;
    ctx.setState((prev) => ({
      ...prev,
      active: {
        ...prev.active,
        loading: false,
        error: toOperatorCoreError("ws", "chat.session.get", err),
      },
    }));
  }
}

export async function newChat(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, error: null } }));
  const expectedAgentId = ctx.store.getSnapshot().agentId;
  try {
    const created = await sessionClient.create({ agent_id: expectedAgentId, channel: "ui" });
    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        sessions: [
          created,
          ...prev.sessions.sessions.filter((session) => session.session_id !== created.session_id),
        ],
      },
      active: {
        sessionId: created.session_id,
        session: created,
        loading: false,
        typing: false,
        error: null,
      },
    }));
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        error: toOperatorCoreError("ws", "chat.session.create", err),
      },
    }));
  }
}

export async function sendMessage(
  ctx: ChatStoreContext,
  content: string,
  input?: { attachedNodeId?: string | null },
): Promise<void> {
  const text = content.trim();
  if (!text) return;

  const transport = buildTransport(ctx);
  const sessionClient = buildSessionClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  const session = snapshot.active.session;
  if (!transport || !sessionClient || !session) return;

  const runId = ++ctx.runIds.send;
  const clientMessageId = createClientMessageId();
  const optimisticUserMessage: UIMessage = {
    id: clientMessageId,
    role: "user",
    parts: [{ type: "text", text }],
  };

  ctx.setState((prev) => ({
    ...prev,
    active:
      prev.active.sessionId === session.session_id && prev.active.session
        ? {
            ...prev.active,
            session: {
              ...prev.active.session,
              messages: [...prev.active.session.messages, optimisticUserMessage],
            },
          }
        : prev.active,
    send: { sending: true, error: null },
  }));

  try {
    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: session.session_id,
      messageId: clientMessageId,
      messages: [...session.messages, optimisticUserMessage],
      trigger: "submit-message",
      body: input?.attachedNodeId ? { attached_node_id: input.attachedNodeId } : undefined,
    });
    await drainStream(stream);
    if (runId !== ctx.runIds.send) return;
    await openSession(ctx, session.session_id);
    if (ctx.store.getSnapshot().agentId === snapshot.agentId) {
      await refreshSessions(ctx);
    }
    if (runId === ctx.runIds.send) {
      ctx.setState((prev) => ({ ...prev, send: { sending: false, error: null } }));
    }
  } catch (err) {
    if (runId !== ctx.runIds.send) return;
    ctx.setState((prev) => ({
      ...prev,
      active:
        prev.active.sessionId === session.session_id && prev.active.session
          ? {
              ...prev.active,
              session: {
                ...prev.active.session,
                messages: prev.active.session.messages.filter(
                  (message) => message.id !== clientMessageId,
                ),
              },
            }
          : prev.active,
      send: { sending: false, error: toOperatorCoreError("ws", "chat.session.send", err) },
    }));
  }
}

export async function deleteActive(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  const sessionId = snapshot.active.sessionId;
  if (!sessionClient || !sessionId) return;

  ctx.setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
  try {
    await sessionClient.delete({ session_id: sessionId });
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        sessions: prev.sessions.sessions.filter((session) => session.session_id !== sessionId),
      },
      active:
        prev.active.sessionId === sessionId
          ? {
              sessionId: null,
              session: null,
              loading: false,
              typing: false,
              error: null,
            }
          : prev.active,
    }));
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "chat.session.delete", err) },
    }));
  }
}
