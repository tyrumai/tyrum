import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import { createStore } from "../store.js";
import {
  archiveSession,
  deleteActive,
  hydrateActiveSession,
  loadArchivedSessions,
  loadMoreArchivedSessions,
  loadMoreSessions,
  newChat,
  openSession,
  refreshAgents,
  refreshSessions,
  setAgentKey,
  unarchiveSession,
  updateActiveMessages,
} from "./chat-store.actions.js";
import {
  createInitialChatState,
  type ChatState,
  type ChatStore,
  type ChatStoreContext,
} from "./chat-store.types.js";

export type {
  ChatAgent,
  ChatAgentsState,
  ChatArchivedSessionsState,
  ChatSessionsState,
  ChatActiveSessionState,
  ChatState,
  ChatStore,
} from "./chat-store.types.js";

export function createChatStore(ws: OperatorWsClient, http: OperatorHttpClient): ChatStore {
  const { store, setState } = createStore<ChatState>(createInitialChatState());

  const ctx: ChatStoreContext = {
    store,
    setState,
    ws,
    http,
    runIds: { agents: 0, sessions: 0, archivedSessions: 0, open: 0 },
  };

  return {
    ...store,
    setAgentKey: (agentKey) => setAgentKey(ctx, agentKey),
    refreshAgents: (input) => refreshAgents(ctx, input),
    refreshSessions: () => refreshSessions(ctx),
    loadMoreSessions: () => loadMoreSessions(ctx),
    openSession: (sessionId) => openSession(ctx, sessionId),
    hydrateActiveSession: (session) => hydrateActiveSession(ctx, session),
    updateActiveMessages: (messages) => updateActiveMessages(ctx, messages),
    newChat: () => newChat(ctx),
    deleteActive: () => deleteActive(ctx),
    archiveSession: (sessionId) => archiveSession(ctx, sessionId),
    unarchiveSession: (sessionId) => unarchiveSession(ctx, sessionId),
    loadArchivedSessions: () => loadArchivedSessions(ctx),
    loadMoreArchivedSessions: () => loadMoreArchivedSessions(ctx),
  };
}
