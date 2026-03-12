import { toOperatorCoreError } from "../operator-error.js";
import type { ChatStoreContext } from "./chat-store.types.js";
import {
  activeToolCallIdsForSession,
  appendTranscriptTextItem,
  mergeFetchedTranscript,
  removeTranscriptEntriesById,
} from "./chat-store.transcript.js";

function createClientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-local-${String(Date.now())}`;
}

function normalizeAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

export function setAgentId(ctx: ChatStoreContext, agentId: string): void {
  const nextAgentId = normalizeAgentId(agentId);
  if (ctx.store.getSnapshot().agentId === nextAgentId) return;

  ctx.runIds.sessions += 1;
  ctx.runIds.open += 1;
  ctx.runIds.send += 1;
  ctx.pendingOpen = null;
  ctx.setState((prev) => ({
    ...prev,
    agentId: nextAgentId,
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    active: {
      sessionId: null,
      session: null,
      loading: false,
      typing: false,
      activeToolCallIds: [],
      error: null,
    },
    send: { sending: false, error: null },
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

export async function loadMoreSessions(ctx: ChatStoreContext): Promise<void> {
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

export async function openSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const trimmed = sessionId.trim();
  if (!trimmed) return;

  const snapshot = ctx.store.getSnapshot();
  const knownThreadId =
    snapshot.active.sessionId === trimmed
      ? (snapshot.active.session?.thread_id ?? null)
      : (snapshot.sessions.sessions.find((session) => session.session_id === trimmed)?.thread_id ??
        null);
  const runId = ++ctx.runIds.open;
  ctx.pendingOpen = {
    sessionId: trimmed,
    threadId: knownThreadId,
    transcript: [],
    typing: false,
  };
  ctx.setState((prev) => ({
    ...prev,
    active: {
      ...prev.active,
      sessionId: trimmed,
      session: null,
      loading: true,
      typing: false,
      activeToolCallIds: [],
      error: null,
    },
    send: { ...prev.send, error: null },
  }));

  try {
    const agentId = ctx.store.getSnapshot().agentId;
    const res = await ctx.ws.sessionGet({ agent_id: agentId, session_id: trimmed });
    if (runId !== ctx.runIds.open) return;
    const pendingOpen =
      ctx.pendingOpen && ctx.pendingOpen.sessionId === trimmed ? ctx.pendingOpen : null;
    ctx.pendingOpen = null;
    ctx.setState((prev) => {
      const session = {
        ...res.session,
        transcript: mergeFetchedTranscript(pendingOpen?.transcript, res.session.transcript),
      };
      return {
        ...prev,
        active: {
          sessionId: trimmed,
          session,
          loading: false,
          typing: pendingOpen?.typing ?? false,
          activeToolCallIds: activeToolCallIdsForSession(session),
          error: null,
        },
      };
    });
  } catch (err) {
    if (runId !== ctx.runIds.open) return;
    if (ctx.pendingOpen?.sessionId === trimmed) {
      ctx.pendingOpen = null;
    }
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

async function refreshActiveSessionIfCurrent(
  ctx: ChatStoreContext,
  input: {
    agentId: string;
    sessionId: string;
    sendRunId?: number;
    optimisticUserMessage?: {
      id: string;
      content: string;
    };
  },
): Promise<void> {
  const isCurrent = (): boolean => {
    const snapshot = ctx.store.getSnapshot();
    return (
      snapshot.agentId === input.agentId &&
      snapshot.active.sessionId === input.sessionId &&
      (input.sendRunId === undefined || ctx.runIds.send === input.sendRunId)
    );
  };

  if (!isCurrent()) return;

  try {
    const res = await ctx.ws.sessionGet({
      agent_id: input.agentId,
      session_id: input.sessionId,
    });
    if (!isCurrent()) return;

    ctx.setState((prev) => {
      if (
        prev.agentId !== input.agentId ||
        prev.active.sessionId !== input.sessionId ||
        !prev.active.session ||
        (input.sendRunId !== undefined && ctx.runIds.send !== input.sendRunId)
      ) {
        return prev;
      }

      const previousTranscript =
        input.optimisticUserMessage &&
        res.session.transcript.some(
          (item) =>
            item.kind === "text" &&
            item.role === "user" &&
            item.content === input.optimisticUserMessage?.content,
        )
          ? removeTranscriptEntriesById(
              prev.active.session.transcript,
              new Set([input.optimisticUserMessage.id]),
            )
          : prev.active.session.transcript;
      const session = {
        ...res.session,
        transcript: mergeFetchedTranscript(previousTranscript, res.session.transcript),
      };
      return {
        ...prev,
        active: {
          ...prev.active,
          session,
          activeToolCallIds: activeToolCallIdsForSession(session),
        },
      };
    });
  } catch {
    // Intentional: keep the current transcript if the post-send reload fails.
  }
}

export async function newChat(ctx: ChatStoreContext): Promise<void> {
  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, error: null } }));
  const expectedAgentId = ctx.store.getSnapshot().agentId;
  try {
    const created = await ctx.ws.sessionCreate({ agent_id: expectedAgentId, channel: "ui" });
    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;
    await refreshSessions(ctx);
    if (ctx.store.getSnapshot().agentId !== expectedAgentId) return;
    await openSession(ctx, created.session_id);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: { ...prev.sessions, error: toOperatorCoreError("ws", "session.create", err) },
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

  const snapshot = ctx.store.getSnapshot();
  const session = snapshot.active.session;
  if (!session) return;

  const runId = ++ctx.runIds.send;
  const expectedAgentId = snapshot.agentId;
  const expectedSessionId = session.session_id;
  const createdAt = new Date().toISOString();
  const clientMessageId = createClientMessageId();

  ctx.setState((prev) => ({
    ...prev,
    active: prev.active.session
      ? {
          ...prev.active,
          session: appendTranscriptTextItem(prev.active.session, {
            id: clientMessageId,
            role: "user",
            content: text,
            createdAt,
          }),
        }
      : prev.active,
    send: { sending: true, error: null },
  }));
  try {
    const payload = {
      agent_id: expectedAgentId,
      channel: session.channel,
      thread_id: session.thread_id,
      content: text,
      ...(input?.attachedNodeId ? { attached_node_id: input.attachedNodeId } : {}),
    } as Parameters<ChatStoreContext["ws"]["sessionSend"]>[0] & { client_message_id?: string };
    payload.client_message_id = clientMessageId;
    await ctx.ws.sessionSend(payload);

    if (runId !== ctx.runIds.send) return;

    await refreshActiveSessionIfCurrent(ctx, {
      agentId: expectedAgentId,
      sessionId: expectedSessionId,
      sendRunId: runId,
      optimisticUserMessage: {
        id: clientMessageId,
        content: text,
      },
    });

    if (ctx.store.getSnapshot().agentId === expectedAgentId) {
      await refreshSessions(ctx);
    }
  } catch (err) {
    if (runId === ctx.runIds.send) {
      ctx.setState((prev) => ({
        ...prev,
        active:
          prev.active.sessionId === expectedSessionId && prev.active.session
            ? {
                ...prev.active,
                session: {
                  ...prev.active.session,
                  transcript: removeTranscriptEntriesById(
                    prev.active.session.transcript,
                    new Set([clientMessageId]),
                  ),
                },
              }
            : prev.active,
        send: { sending: false, error: toOperatorCoreError("ws", "session.send", err) },
      }));
    }
    return;
  }

  if (runId === ctx.runIds.send) {
    ctx.setState((prev) => ({ ...prev, send: { sending: false, error: null } }));
  }
}

export async function compactActive(
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
      await openSession(ctx, sessionId);
    }
    await refreshSessions(ctx);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "session.compact", err) },
    }));
  }
}

export async function deleteActive(ctx: ChatStoreContext): Promise<void> {
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
        active: {
          sessionId: null,
          session: null,
          loading: false,
          typing: false,
          activeToolCallIds: [],
          error: null,
        },
      }));
    }
    await refreshSessions(ctx);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "session.delete", err) },
    }));
  }
}
