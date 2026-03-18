import type { TyrumAiSdkChatSessionSummary } from "@tyrum/client/browser";
import {
  createTyrumAiSdkChatSessionClient,
  supportsTyrumAiSdkChatSocket,
} from "@tyrum/client/browser";
import { toOperatorCoreError } from "../operator-error.js";
import type { ChatStoreContext } from "./chat-store.types.js";

function buildSessionClient(ctx: ChatStoreContext) {
  const socket = supportsTyrumAiSdkChatSocket(ctx.ws) ? ctx.ws : null;
  return socket ? createTyrumAiSdkChatSessionClient({ client: socket }) : null;
}

function compareSessionActivity(
  left: TyrumAiSdkChatSessionSummary,
  right: TyrumAiSdkChatSessionSummary,
): number {
  if (left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at);
  }
  return right.session_id.localeCompare(left.session_id);
}

function patchSessionList(
  sessions: TyrumAiSdkChatSessionSummary[],
  session: TyrumAiSdkChatSessionSummary,
): TyrumAiSdkChatSessionSummary[] {
  return [...sessions.filter((entry) => entry.session_id !== session.session_id), session].toSorted(
    compareSessionActivity,
  );
}

export async function archiveSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  try {
    await sessionClient.archive({ session_id: sessionId, archived: true });
    ctx.setState((prev) => {
      const session = prev.sessions.sessions.find((s) => s.session_id === sessionId);
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          sessions: prev.sessions.sessions.filter((s) => s.session_id !== sessionId),
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
        error: toOperatorCoreError("ws", "chat.session.archive", err),
      },
    }));
  }
}

export async function unarchiveSession(ctx: ChatStoreContext, sessionId: string): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  try {
    await sessionClient.archive({ session_id: sessionId, archived: false });
    ctx.setState((prev) => {
      const session = prev.archivedSessions.sessions.find((s) => s.session_id === sessionId);
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
          sessions: prev.archivedSessions.sessions.filter((s) => s.session_id !== sessionId),
        },
      };
    });
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        ...prev.archivedSessions,
        error: toOperatorCoreError("ws", "chat.session.archive", err),
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
      agent_id: snapshot.agentId,
      channel: "ui",
      archived: true,
      limit: 50,
    });
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        sessions: res.sessions,
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
        error: toOperatorCoreError("ws", "chat.session.list", err),
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
      agent_id: snapshot.agentId,
      channel: "ui",
      archived: true,
      limit: 50,
      cursor,
    });
    if (runId !== ctx.runIds.archivedSessions) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedSessions: {
        sessions: [...prev.archivedSessions.sessions, ...res.sessions],
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
        error: toOperatorCoreError("ws", "chat.session.list", err),
      },
    }));
  }
}
