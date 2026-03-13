import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import { createStore } from "../store.js";
import {
  deleteActive,
  loadMoreSessions,
  newChat,
  openSession,
  refreshAgents,
  refreshSessions,
  sendMessage,
  setAgentId,
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
  ChatSessionsState,
  ChatActiveSessionState,
  ChatSendState,
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
    runIds: { agents: 0, sessions: 0, open: 0, send: 0 },
  };

  return {
    ...store,
    setAgentId: (agentId) => setAgentId(ctx, agentId),
    refreshAgents: (input) => refreshAgents(ctx, input),
    refreshSessions: () => refreshSessions(ctx),
    loadMoreSessions: () => loadMoreSessions(ctx),
    openSession: (sessionId) => openSession(ctx, sessionId),
    newChat: () => newChat(ctx),
    sendMessage: (content, input) => sendMessage(ctx, content, input),
    deleteActive: () => deleteActive(ctx),
  };
}
