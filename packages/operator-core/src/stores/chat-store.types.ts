import type { WsSessionGetSession, WsSessionListItem } from "@tyrum/client";
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
  sessions: WsSessionListItem[];
  nextCursor: string | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface ChatActiveSessionState {
  sessionId: string | null;
  session: ChatSession | null;
  loading: boolean;
  typing: boolean;
  activeToolCallIds: string[];
  error: OperatorCoreError | null;
}

export interface ChatSendState {
  sending: boolean;
  error: OperatorCoreError | null;
}

export interface ChatState {
  agentId: string;
  agents: ChatAgentsState;
  sessions: ChatSessionsState;
  active: ChatActiveSessionState;
  send: ChatSendState;
}

export interface ChatStore extends ExternalStore<ChatState> {
  setAgentId(agentId: string): void;
  refreshAgents(input?: { includeDefault?: boolean }): Promise<void>;
  refreshSessions(): Promise<void>;
  loadMoreSessions(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  newChat(): Promise<void>;
  sendMessage(content: string, input?: { attachedNodeId?: string | null }): Promise<void>;
  compactActive(input?: { keepLastMessages?: number }): Promise<void>;
  deleteActive(): Promise<void>;
}

export type ChatReasoningTranscriptItem = {
  kind: "reasoning";
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ChatSession = Omit<WsSessionGetSession, "transcript"> & {
  transcript: Array<WsSessionGetSession["transcript"][number] | ChatReasoningTranscriptItem>;
};

export type ChatStoreRunIds = {
  agents: number;
  sessions: number;
  open: number;
  send: number;
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
      typing: false,
      activeToolCallIds: [],
      error: null,
    },
    send: {
      sending: false,
      error: null,
    },
  };
}
