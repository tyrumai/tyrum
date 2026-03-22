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
  workSessionKey?: string;
  workLane?: string;
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
    workSessionKey:
      typeof input.metadata?.["work_session_key"] === "string"
        ? input.metadata["work_session_key"]
        : undefined,
    workLane:
      typeof input.metadata?.["work_lane"] === "string" ? input.metadata["work_lane"] : undefined,
    execution: input.execution,
  };
}
