import type {
  TyrumAiSdkChatSession,
  TyrumAiSdkChatSessionSummary,
  UIMessage,
} from "@tyrum/client/browser";
import {
  createTyrumAiSdkChatSessionClient,
  supportsTyrumAiSdkChatSocket,
} from "@tyrum/client/browser";
import { toOperatorCoreError } from "../operator-error.js";
import type { ChatStoreContext } from "./chat-store.types.js";

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

function toSessionSummary(
  session: TyrumAiSdkChatSession | TyrumAiSdkChatSessionSummary,
): TyrumAiSdkChatSessionSummary {
  return {
    session_id: session.session_id,
    agent_id: session.agent_id,
    channel: session.channel,
    thread_id: session.thread_id,
    title: session.title,
    message_count: session.message_count,
    updated_at: session.updated_at,
    created_at: session.created_at,
    last_message: session.last_message ?? null,
  };
}

function buildPreview(messages: UIMessage[]): TyrumAiSdkChatSessionSummary["last_message"] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== "text") {
        continue;
      }
      const text = typeof part.text === "string" ? part.text.trim() : "";
      if (text.length > 0) {
        return { role: message.role, text };
      }
    }
  }
  return null;
}

function patchSessionList(
  sessions: TyrumAiSdkChatSessionSummary[],
  session: TyrumAiSdkChatSession | TyrumAiSdkChatSessionSummary,
): TyrumAiSdkChatSessionSummary[] {
  const nextSummary = toSessionSummary(session);
  return [nextSummary, ...sessions.filter((entry) => entry.session_id !== nextSummary.session_id)];
}

function applySessionMessages(
  session: TyrumAiSdkChatSession,
  messages: UIMessage[],
): TyrumAiSdkChatSession {
  return {
    ...session,
    messages,
    message_count: messages.length,
    last_message: buildPreview(messages),
    updated_at: new Date().toISOString(),
  };
}

export function setAgentId(ctx: ChatStoreContext, agentId: string): void {
  const nextAgentId = normalizeAgentId(agentId);
  if (ctx.store.getSnapshot().agentId === nextAgentId) return;

  ctx.runIds.sessions += 1;
  ctx.runIds.open += 1;
  ctx.setState((prev) => ({
    ...prev,
    agentId: nextAgentId,
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    active: {
      sessionId: null,
      session: null,
      loading: false,
      error: null,
    },
  }));
}

export async function refreshAgents(
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
      error: null,
    },
  }));

  try {
    const session = await sessionClient.get({ session_id: trimmed });
    if (runId !== ctx.runIds.open) return;
    hydrateActiveSession(ctx, session);
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
    hydrateActiveSession(ctx, created);
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

export function hydrateActiveSession(
  ctx: ChatStoreContext,
  session: TyrumAiSdkChatSession | null,
): void {
  ctx.setState((prev) => ({
    ...prev,
    sessions:
      session === null
        ? prev.sessions
        : {
            ...prev.sessions,
            sessions: patchSessionList(prev.sessions.sessions, session),
          },
    active:
      session === null
        ? {
            sessionId: null,
            session: null,
            loading: false,
            error: null,
          }
        : {
            sessionId: session.session_id,
            session,
            loading: false,
            error: null,
          },
  }));
}

export function updateActiveMessages(ctx: ChatStoreContext, messages: UIMessage[]): void {
  ctx.setState((prev) => {
    const session = prev.active.session;
    if (!session) {
      return prev;
    }
    const nextSession = applySessionMessages(session, messages);
    return {
      ...prev,
      sessions: {
        ...prev.sessions,
        sessions: patchSessionList(prev.sessions.sessions, nextSession),
      },
      active: {
        ...prev.active,
        session: nextSession,
      },
    };
  });
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
