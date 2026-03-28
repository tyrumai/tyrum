import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import { createStore } from "../store.js";
import {
  archiveConversation,
  deleteActive,
  hydrateActiveConversation,
  loadArchivedConversations,
  loadMoreArchivedConversations,
  loadMoreConversations,
  newChat,
  openConversation,
  refreshAgents,
  refreshConversations,
  setAgentKey,
  unarchiveConversation,
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
  ChatArchivedConversationsState,
  ChatConversationsState,
  ChatActiveConversationState,
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
    requestIds: { agents: 0, conversations: 0, archivedConversations: 0, openConversation: 0 },
  };

  return {
    ...store,
    setAgentKey: (agentKey) => setAgentKey(ctx, agentKey),
    refreshAgents: (input) => refreshAgents(ctx, input),
    refreshConversations: () => refreshConversations(ctx),
    loadMoreConversations: () => loadMoreConversations(ctx),
    openConversation: (conversationId) => openConversation(ctx, conversationId),
    hydrateActiveConversation: (conversation) => hydrateActiveConversation(ctx, conversation),
    updateActiveMessages: (messages) => updateActiveMessages(ctx, messages),
    newChat: () => newChat(ctx),
    deleteActive: () => deleteActive(ctx),
    archiveConversation: (conversationId) => archiveConversation(ctx, conversationId),
    unarchiveConversation: (conversationId) => unarchiveConversation(ctx, conversationId),
    loadArchivedConversations: () => loadArchivedConversations(ctx),
    loadMoreArchivedConversations: () => loadMoreArchivedConversations(ctx),
  };
}
