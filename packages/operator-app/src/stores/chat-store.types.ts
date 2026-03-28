import type {
  TyrumAiSdkChatConversation,
  TyrumAiSdkChatConversationSummary,
  UIMessage,
} from "@tyrum/transport-sdk";
import type { AgentPersona } from "@tyrum/contracts";
import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import type { OperatorCoreError } from "../operator-error.js";
import type { ExternalStore } from "../store.js";

export type ChatAgent = {
  agent_key: string;
  persona?: AgentPersona;
};

export interface ChatAgentsState {
  agents: ChatAgent[];
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatConversationsState {
  conversations: TyrumAiSdkChatConversationSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatArchivedConversationsState {
  conversations: TyrumAiSdkChatConversationSummary[];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
  error: OperatorCoreError | null;
}

export interface ChatActiveConversationState {
  conversationId: string | null;
  conversation: TyrumAiSdkChatConversation | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatState {
  agentKey: string;
  agents: ChatAgentsState;
  conversations: ChatConversationsState;
  archivedConversations: ChatArchivedConversationsState;
  active: ChatActiveConversationState;
}

export interface ChatStore extends ExternalStore<ChatState> {
  setAgentKey(agentKey: string): void;
  refreshAgents(input?: { includeDefault?: boolean }): Promise<void>;
  refreshConversations(): Promise<void>;
  loadMoreConversations(): Promise<void>;
  openConversation(conversationId: string): Promise<void>;
  hydrateActiveConversation(conversation: TyrumAiSdkChatConversation | null): void;
  updateActiveMessages(messages: UIMessage[]): void;
  newChat(): Promise<void>;
  deleteActive(): Promise<void>;
  archiveConversation(conversationId: string): Promise<void>;
  unarchiveConversation(conversationId: string): Promise<void>;
  loadArchivedConversations(): Promise<void>;
  loadMoreArchivedConversations(): Promise<void>;
}

export type ChatStoreRequestIds = {
  agents: number;
  conversations: number;
  archivedConversations: number;
  openConversation: number;
};

export type ChatStoreContext = {
  store: ExternalStore<ChatState>;
  setState: (updater: (prev: ChatState) => ChatState) => void;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  requestIds: ChatStoreRequestIds;
};

export function createInitialChatState(): ChatState {
  return {
    agentKey: "",
    agents: {
      agents: [],
      loading: false,
      error: null,
    },
    conversations: {
      conversations: [],
      nextCursor: null,
      loading: false,
      error: null,
    },
    archivedConversations: {
      conversations: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: {
      conversationId: null,
      conversation: null,
      loading: false,
      error: null,
    },
  };
}
