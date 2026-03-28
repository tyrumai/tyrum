export function buildToolExecutionContext(input: {
  tenantId: string;
  conversationId: string;
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
  conversationId: string;
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
    conversationId: input.conversationId,
    channel: input.channel,
    threadId: input.threadId,
    workConversationKey:
      typeof input.metadata?.["work_conversation_key"] === "string"
        ? input.metadata["work_conversation_key"]
        : undefined,
    execution: input.execution,
  };
}
