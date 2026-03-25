import { toOperatorCoreError } from "../operator-error.js";
import { buildSessionClient, patchSessionList } from "./chat-store.actions.js";
import type { ChatStoreContext } from "./chat-store.types.js";

export async function archiveSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  try {
    await sessionClient.archive({ conversation_id: sessionId, archived: true });
    ctx.setState((prev) => {
      const session = prev.sessions.sessions.find((s) => s.conversation_id === sessionId);
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          sessions: prev.sessions.sessions.filter((s) => s.conversation_id !== sessionId),
        },
        archivedSessions: session
          ? {
              ...prev.archivedSessions,
              sessions: prev.archivedSessions.loaded
                ? [{ ...session, archived: true }, ...prev.archivedSessions.sessions]
                : prev.archivedSessions.sessions,
            }
          : prev.archivedSessions,
        active:
          prev.active.sessionId === sessionId
            ? { sessionId: null, session: null, loading: false, error: null }
            : prev.active,
      };
    });
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        error: toOperatorCoreError("ws", "conversation.archive", err),
      },
    }));
  }
}

export async function unarchiveSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  try {
    await sessionClient.archive({ conversation_id: sessionId, archived: false });
    ctx.setState((prev) => {
      const session = prev.archivedSessions.sessions.find((s) => s.conversation_id === sessionId);
      return {
        ...prev,
        sessions: session
          ? {
              ...prev.sessions,
              sessions: patchSessionList(prev.sessions.sessions, {
                ...session,
                archived: false,
              }),
            }
          : prev.sessions,
        archivedSessions: {
          ...prev.archivedSessions,
          sessions: prev.archivedSessions.sessions.filter((s) => s.conversation_id !== sessionId),
        },
      };
    });
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        ...prev.archivedSessions,
        error: toOperatorCoreError("ws", "conversation.archive", err),
      },
    }));
  }
}

export async function loadArchivedSessions(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!sessionClient || snapshot.archivedSessions.loading) return;

  const runId = ++ctx.runIds.archivedSessions;
  ctx.setState((prev) => ({
    ...prev,
    archivedSessions: { ...prev.archivedSessions, loading: true, error: null },
  }));
  try {
    const res = await sessionClient.list({
      channel: "ui",
      archived: true,
      limit: 50,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        sessions: res.conversations,
        nextCursor: res.next_cursor ?? null,
        loading: false,
        loaded: true,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        ...prev.archivedSessions,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}

export async function loadMoreArchivedSessions(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!sessionClient || snapshot.archivedSessions.loading) return;
  const cursor = snapshot.archivedSessions.nextCursor;
  if (!cursor) return;

  const runId = ++ctx.runIds.archivedSessions;
  ctx.setState((prev) => ({
    ...prev,
    archivedSessions: { ...prev.archivedSessions, loading: true, error: null },
  }));
  try {
    const res = await sessionClient.list({
      channel: "ui",
      archived: true,
      limit: 50,
      cursor,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        sessions: [...prev.archivedSessions.sessions, ...res.conversations],
        nextCursor: res.next_cursor ?? null,
        loading: false,
        loaded: true,
        error: null,
      },
    }));
  } catch (err) {
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        ...prev.archivedSessions,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}
