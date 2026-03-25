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

export interface ChatSessionsState {
  sessions: TyrumAiSdkChatConversationSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatArchivedSessionsState {
  sessions: TyrumAiSdkChatConversationSummary[];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
  error: OperatorCoreError | null;
}

export interface ChatActiveSessionState {
  sessionId: string | null;
  session: TyrumAiSdkChatConversation | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatState {
  agentKey: string;
  agents: ChatAgentsState;
  sessions: ChatSessionsState;
  archivedSessions: ChatArchivedSessionsState;
  active: ChatActiveSessionState;
}

export interface ChatStore extends ExternalStore<ChatState> {
  setAgentKey(agentKey: string): void;
  refreshAgents(input?: { includeDefault?: boolean }): Promise<void>;
  refreshSessions(): Promise<void>;
  loadMoreSessions(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  hydrateActiveSession(session: TyrumAiSdkChatConversation | null): void;
  updateActiveMessages(messages: UIMessage[]): void;
  newChat(): Promise<void>;
  deleteActive(): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  unarchiveSession(sessionId: string): Promise<void>;
  loadArchivedSessions(): Promise<void>;
  loadMoreArchivedSessions(): Promise<void>;
}

export type ChatStoreRunIds = {
  agents: number;
  sessions: number;
  archivedSessions: number;
  open: number;
};

export type ChatStoreContext = {
  store: ExternalStore<ChatState>;
  setState: (updater: (prev: ChatState) => ChatState) => void;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  runIds: ChatStoreRunIds;
};

export function createInitialChatState(): ChatState {
  return {
    agentKey: "",
    agents: {
      agents: [],
      loading: false,
      error: null,
    },
    sessions: {
      sessions: [],
      nextCursor: null,
      loading: false,
      error: null,
    },
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
  };
}
