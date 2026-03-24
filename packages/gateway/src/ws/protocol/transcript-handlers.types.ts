import type {
  ExecutionAttempt,
  ExecutionRun,
  ExecutionRunStatus,
  ExecutionStep,
  NormalizedContainerKind,
  TyrumUIMessage,
} from "@tyrum/contracts";

export type LatestRunInfo = {
  latestRunId: string | null;
  latestRunStatus: ExecutionRunStatus | null;
  hasActiveRun: boolean;
};

export type SessionRecord = {
  sessionId: string;
  sessionKey: string;
  agentKey: string;
  channel: string;
  threadId: string;
  accountKey: string;
  containerKind: NormalizedContainerKind;
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
  run: ExecutionRun;
  steps: ExecutionStep[];
  attempts: ExecutionAttempt[];
};
