import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
  ClientCapability as ClientCapabilityT,
  EvaluationContext,
  ExecutionBudgets as ExecutionBudgetsT,
  ExecutionTrigger as ExecutionTriggerT,
} from "@tyrum/schemas";

export interface StepResult {
  success: boolean;
  result?: unknown;
  error?: string;
  evidence?: EvaluationContext;
  artifacts?: ArtifactRefT[];
  cost?: AttemptCostT;
  pause?: {
    kind: string;
    prompt: string;
    detail: string;
    context?: unknown;
    expiresAt?: string | null;
  };
}

export interface StepExecutionContext {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  approvalId: string | null;
  key: string;
  lane: string;
  workspaceId: string;
  policySnapshotId: string | null;
}

export interface StepExecutor {
  execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult>;
}

export interface ExecutionClock {
  nowMs: number;
  nowIso: string;
}

export type ClockFn = () => ExecutionClock;

export interface EnqueuePlanInput {
  tenantId: string;
  key: string;
  lane: string;
  /** Preferred stable workspace key used to resolve the internal workspace_id (default: "default"). */
  workspaceKey?: string;
  /**
   * Legacy alias accepted for backward compatibility.
   * This may be either a workspace key or an already-resolved workspace_id UUID.
   */
  workspaceId?: string;
  planId: string;
  requestId: string;
  steps: ActionPrimitiveT[];
  policySnapshotId?: string;
  budgets?: ExecutionBudgetsT;
  trigger?: ExecutionTriggerT;
}

export interface EnqueuePlanResult {
  jobId: string;
  runId: string;
}

export interface WorkerTickInput {
  workerId: string;
  executor: StepExecutor;
  /** When set, only this run_id will be considered for execution. */
  runId?: string;
}

export interface ExecutionConcurrencyLimits {
  /** Maximum running attempts across the whole gateway/worker pool. */
  global?: number;
  /** Maximum running attempts per agent_id (derived from `key`). */
  perAgent?: number;
  /** Maximum running attempts per required capability (e.g. cli/playwright). */
  perCapability?: Partial<Record<ClientCapabilityT, number>>;
}
