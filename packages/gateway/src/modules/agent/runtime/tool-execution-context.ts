export function buildToolExecutionContext(input: {
  tenantId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  metadata: Record<string, unknown> | undefined;
  planId: string;
  execution?: {
    runId: string;
    stepIndex: number;
    stepId: string;
    stepApprovalId?: string;
  };
}): {
  tenantId: string;
  planId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  workConversationKey?: string;
  execution?: {
    runId: string;
    stepIndex: number;
    stepId: string;
    stepApprovalId?: string;
  };
} {
  return {
    tenantId: input.tenantId,
    planId: input.planId,
    sessionId: input.sessionId,
    channel: input.channel,
    threadId: input.threadId,
    workConversationKey:
      typeof input.metadata?.["work_conversation_key"] === "string"
        ? input.metadata["work_conversation_key"]
        : undefined,
    execution: input.execution,
  };
}
