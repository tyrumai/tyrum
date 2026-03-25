import type {
  ExecutionAttempt,
  ExecutionStep,
  TranscriptConversationSummary,
  Turn,
  TurnStatus,
  TyrumUIMessage,
} from "@tyrum/contracts";

export type LatestRunInfo = {
  latestTurnId: string | null;
  latestTurnStatus: TurnStatus | null;
  hasActiveTurn: boolean;
};

export type SessionRecord = {
  sessionId: string;
  sessionKey: string;
  agentKey: string;
  channel: string;
  accountKey: string | null;
  threadId: string;
  containerKind: string | null;
  title: string;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  archived: boolean;
};

export type ListSessionRecordsResult = {
  sessions: SessionRecord[];
  nextCursor: string | null;
};

export type SessionLineageRecord = SessionRecord & {
  messages: TyrumUIMessage[];
};

export type RunDetail = {
  turn: Turn;
  steps: ExecutionStep[];
  attempts: ExecutionAttempt[];
};

export type TranscriptConversationSummaryRecord = TranscriptConversationSummary;
