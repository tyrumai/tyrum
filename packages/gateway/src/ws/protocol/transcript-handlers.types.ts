import type {
  ExecutionAttempt,
  ExecutionStep,
  TranscriptConversationSummary,
  Turn,
  TurnStatus,
  TyrumUIMessage,
} from "@tyrum/contracts";

export type LatestTurnInfo = {
  latestTurnId: string | null;
  latestTurnStatus: TurnStatus | null;
  hasActiveTurn: boolean;
};

export type ConversationRecord = {
  conversationId: string;
  conversationKey: string;
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

export type ListConversationRecordsResult = {
  conversations: ConversationRecord[];
  nextCursor: string | null;
};

export type ConversationLineageRecord = ConversationRecord & {
  messages: TyrumUIMessage[];
};

export type TurnDetail = {
  turn: Turn;
  steps: ExecutionStep[];
  attempts: ExecutionAttempt[];
};

export type TranscriptConversationSummaryRecord = TranscriptConversationSummary;
