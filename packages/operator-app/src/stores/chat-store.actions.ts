import {
  createTyrumAiSdkChatConversationClient,
  supportsTyrumAiSdkChatSocket,
  type TyrumAiSdkChatConversation,
  type TyrumAiSdkChatConversationSummary,
  type UIMessage,
} from "@tyrum/transport-sdk";
import { toOperatorCoreError } from "../operator-error.js";
import type { ChatState, ChatStoreContext } from "./chat-store.types.js";

function normalizeAgentKey(agentKey: string): string {
  return agentKey.trim();
}

function requireChatSocket(ctx: ChatStoreContext) {
  return supportsTyrumAiSdkChatSocket(ctx.ws) ? ctx.ws : null;
}

export function buildSessionClient(ctx: ChatStoreContext) {
  const socket = requireChatSocket(ctx);
  return socket ? createTyrumAiSdkChatConversationClient({ client: socket }) : null;
}

function toSessionSummary(
  session: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): TyrumAiSdkChatConversationSummary {
  return {
    conversation_id: session.conversation_id,
    agent_key: session.agent_key,
    channel: session.channel,
    thread_id: session.thread_id,
    title: session.title,
    message_count: session.message_count,
    updated_at: session.updated_at,
    created_at: session.created_at,
    last_message: session.last_message ?? null,
    archived: session.archived ?? false,
  };
}

function buildPreview(messages: UIMessage[]): TyrumAiSdkChatConversationSummary["last_message"] {
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

function compareSessionActivity(
  left: TyrumAiSdkChatConversationSummary,
  right: TyrumAiSdkChatConversationSummary,
): number {
  if (left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at);
  }
  return right.conversation_id.localeCompare(left.conversation_id);
}

function isComparableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toComparableEntries(record: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function areComparableValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areComparableValuesEqual(value, right[index]));
  }
  if (!isComparableRecord(left) || !isComparableRecord(right)) {
    return false;
  }

  const leftEntries = toComparableEntries(left);
  const rightEntries = toComparableEntries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([leftKey, leftValue], index) => {
    const rightEntry = rightEntries[index];
    return (
      rightEntry !== undefined &&
      leftKey === rightEntry[0] &&
      areComparableValuesEqual(leftValue, rightEntry[1])
    );
  });
}

function areMessagesEqual(left: UIMessage[], right: UIMessage[]): boolean {
  return areComparableValuesEqual(left, right);
}

export function patchSessionList(
  sessions: TyrumAiSdkChatConversationSummary[],
  session: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): TyrumAiSdkChatConversationSummary[] {
  const nextSummary = toSessionSummary(session);
  return [
    ...sessions.filter((entry) => entry.conversation_id !== nextSummary.conversation_id),
    nextSummary,
  ].toSorted(compareSessionActivity);
}

function routeSessionSummary(
  prev: ChatState,
  session: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): Pick<ChatState, "archivedSessions" | "sessions"> {
  const nextSummary = toSessionSummary(session);
  const filteredActiveSessions = prev.sessions.sessions.filter(
    (entry) => entry.conversation_id !== nextSummary.conversation_id,
  );
  const filteredArchivedSessions = prev.archivedSessions.sessions.filter(
    (entry) => entry.conversation_id !== nextSummary.conversation_id,
  );

  if (nextSummary.archived) {
    const shouldPatchArchived =
      prev.archivedSessions.loaded ||
      prev.archivedSessions.sessions.some(
        (entry) => entry.conversation_id === nextSummary.conversation_id,
      );
    return {
      sessions: {
        ...prev.sessions,
        sessions: filteredActiveSessions,
      },
      archivedSessions: {
        ...prev.archivedSessions,
        sessions: shouldPatchArchived
          ? patchSessionList(prev.archivedSessions.sessions, nextSummary)
          : filteredArchivedSessions,
      },
    };
  }

  return {
    sessions: {
      ...prev.sessions,
      sessions: patchSessionList(prev.sessions.sessions, nextSummary),
    },
    archivedSessions: {
      ...prev.archivedSessions,
      sessions: filteredArchivedSessions,
    },
  };
}

function applySessionMessages(
  session: TyrumAiSdkChatConversation,
  messages: UIMessage[],
): TyrumAiSdkChatConversation {
  return {
    ...session,
    messages,
    message_count: messages.length,
    last_message: buildPreview(messages),
    updated_at: new Date().toISOString(),
  };
}

export function setAgentKey(ctx: ChatStoreContext, agentKey: string): void {
  const nextAgentKey = normalizeAgentKey(agentKey);
  if (ctx.store.getSnapshot().agentKey === nextAgentKey) return;

  ctx.runIds.sessions += 1;
  ctx.runIds.archivedSessions += 1;
  ctx.runIds.open += 1;
  ctx.setState((prev) => ({
    ...prev,
    agentKey: nextAgentKey,
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    archivedSessions: {
      sessions: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
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
          agent_key: agent.agent_key,
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
          "conversation.list",
          new Error("conversation transport unavailable"),
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
    const agentKey = ctx.store.getSnapshot().agentKey;
    const res = await sessionClient.list({
      channel: "ui",
      limit: 50,
      ...(agentKey ? { agent_key: agentKey } : {}),
    });
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        sessions: res.conversations,
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
        error: toOperatorCoreError("ws", "conversation.list", err),
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
      channel: "ui",
      limit: 50,
      cursor,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (runId !== ctx.runIds.sessions) return;
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        sessions: [...prev.sessions.sessions, ...res.conversations],
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
        error: toOperatorCoreError("ws", "conversation.list", err),
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
    const session = await sessionClient.get({ conversation_id: trimmed });
    if (runId !== ctx.runIds.open) return;
    hydrateActiveSession(ctx, session);
  } catch (err) {
    if (runId !== ctx.runIds.open) return;
    ctx.setState((prev) => ({
      ...prev,
      active: {
        ...prev.active,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.get", err),
      },
    }));
  }
}

export async function newChat(ctx: ChatStoreContext): Promise<void> {
  const sessionClient = buildSessionClient(ctx);
  if (!sessionClient) return;

  ctx.setState((prev) => ({ ...prev, sessions: { ...prev.sessions, error: null } }));
  const expectedAgentKey = ctx.store.getSnapshot().agentKey;
  try {
    const created = await sessionClient.create({
      channel: "ui",
      ...(expectedAgentKey ? { agent_key: expectedAgentKey } : {}),
    });
    if (ctx.store.getSnapshot().agentKey !== expectedAgentKey) return;
    hydrateActiveSession(ctx, created);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        error: toOperatorCoreError("ws", "conversation.create", err),
      },
    }));
  }
}

export function hydrateActiveSession(
  ctx: ChatStoreContext,
  session: TyrumAiSdkChatConversation | null,
): void {
  ctx.setState((prev) => ({
    ...prev,
    ...(session === null ? {} : routeSessionSummary(prev, session)),
    active:
      session === null
        ? {
            sessionId: null,
            session: null,
            loading: false,
            error: null,
          }
        : {
            sessionId: session.conversation_id,
            session,
            loading: false,
            error: null,
          },
  }));
}

export function updateActiveMessages(ctx: ChatStoreContext, messages: UIMessage[]): void {
  ctx.setState((prev) => {
    const session = prev.active.session;
    if (!session || areMessagesEqual(session.messages, messages)) {
      return prev;
    }
    const nextSession = applySessionMessages(session, messages);
    return {
      ...prev,
      ...routeSessionSummary(prev, nextSession),
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
    await sessionClient.delete({ conversation_id: sessionId });
    ctx.setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        sessions: prev.sessions.sessions.filter((session) => session.conversation_id !== sessionId),
      },
      archivedSessions: {
        ...prev.archivedSessions,
        sessions: prev.archivedSessions.sessions.filter(
          (session) => session.conversation_id !== sessionId,
        ),
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
      active: { ...prev.active, error: toOperatorCoreError("ws", "conversation.delete", err) },
    }));
  }
}

export {
  archiveSession,
  unarchiveSession,
  loadArchivedSessions,
  loadMoreArchivedSessions,
} from "./chat-store-archive.actions.js";
