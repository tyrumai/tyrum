import type { TyrumAiSdkChatSessionSummary } from "@tyrum/client/browser";
import type { AgentPersona } from "@tyrum/schemas";
import type { OperatorHttpClient, OperatorWsClient } from "../deps.js";
import type { OperatorCoreError } from "../operator-error.js";
import type { ExternalStore } from "../store.js";

export type ChatAgent = {
  agent_id: string;
  persona?: AgentPersona;
};

export interface ChatAgentsState {
  agents: ChatAgent[];
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatSessionsState {
  sessions: TyrumAiSdkChatSessionSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatActiveSessionState {
  sessionId: string | null;
  session: TyrumAiSdkChatSessionSummary | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatState {
  agentId: string;
  agents: ChatAgentsState;
  sessions: ChatSessionsState;
  active: ChatActiveSessionState;
}

export interface ChatStore extends ExternalStore<ChatState> {
  setAgentId(agentId: string): void;
  refreshAgents(input?: { includeDefault?: boolean }): Promise<void>;
  refreshSessions(): Promise<void>;
  loadMoreSessions(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  newChat(): Promise<void>;
  deleteActive(): Promise<void>;
}

export type ChatStoreRunIds = {
  agents: number;
  sessions: number;
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
    agentId: "default",
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
    active: {
      sessionId: null,
      session: null,
      loading: false,
      error: null,
    },
  };
}
