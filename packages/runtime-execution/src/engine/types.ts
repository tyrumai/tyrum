import type {
  ActionPrimitive as ActionPrimitiveT,
  ApprovalKind as ApprovalKindT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
  ClientCapability as ClientCapabilityT,
  EvaluationContext,
  ExecutionBudgets as ExecutionBudgetsT,
  ExecutionTrigger as ExecutionTriggerT,
} from "@tyrum/contracts";

export interface StepResult {
  success: boolean;
  result?: unknown;
  error?: string;
  failureKind?: "policy";
  evidence?: EvaluationContext;
  artifacts?: ArtifactRefT[];
  cost?: AttemptCostT;
  pause?: {
    kind: ApprovalKindT;
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
  agentId?: string | null;
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
  shutdown?(): Promise<void>;
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

export interface ExecutionPauseRunForApprovalOptions {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  planId: string;
  stepIndex: number;
  runId: string;
  stepId: string;
  attemptId?: string;
  jobId: string;
  key: string;
  lane: string;
  workerId: string;
}

export interface ExecutionPauseRunForApprovalInput {
  kind: ApprovalKindT;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
}

export interface ExecutionMaybeRetryOrFailStepOptions<TTx> {
  tx: TTx;
  nowIso: string;
  tenantId: string;
  agentId: string;
  attemptNum: number;
  maxAttempts: number;
  stepId: string;
  attemptId?: string;
  runId: string;
  jobId: string;
  workspaceId: string;
  key: string;
  lane: string;
  workerId: string;
}

export interface ExecutionApprovalPort<TTx> {
  maybeRetryOrFailStep(opts: ExecutionMaybeRetryOrFailStepOptions<TTx>): Promise<boolean>;
  pauseRunForApproval(
    tx: TTx,
    opts: ExecutionPauseRunForApprovalOptions,
    input: ExecutionPauseRunForApprovalInput,
  ): Promise<{ approvalId: string; resumeToken: string }>;
}

export interface ExecutionArtifactRecordScope {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  workspaceId: string;
  agentId: string | null;
}

export interface ExecutionArtifactPort<TTx> {
  recordArtifactsTx(
    tx: TTx,
    scope: ExecutionArtifactRecordScope,
    artifacts: ArtifactRefT[],
  ): Promise<void>;
}

export interface ExecutionRunEventPort<TTx> {
  emitRunUpdatedTx(tx: TTx, runId: string): Promise<void>;
  emitStepUpdatedTx(tx: TTx, stepId: string): Promise<void>;
  emitAttemptUpdatedTx(tx: TTx, attemptId: string): Promise<void>;
}

export interface ExecutionEventPort<
  TTx,
  TEvent = unknown,
  TMessage = TEvent,
  TAudience = unknown,
> extends ExecutionRunEventPort<TTx> {
  enqueueWsMessage(
    tx: TTx,
    tenantId: string,
    message: TMessage,
    audience?: TAudience,
  ): Promise<void>;
  enqueueWsEvent(tx: TTx, tenantId: string, evt: TEvent, audience?: TAudience): Promise<void>;
  emitArtifactCreatedTx(
    tx: TTx,
    opts: { tenantId: string; runId: string; artifact: ArtifactRefT },
  ): Promise<void>;
  emitArtifactAttachedTx(
    tx: TTx,
    opts: {
      tenantId: string;
      runId: string;
      stepId: string;
      attemptId: string;
      artifact: ArtifactRefT;
    },
  ): Promise<void>;
  emitRunIdEventTx(
    tx: TTx,
    type: "run.queued" | "run.started" | "run.resumed" | "run.completed" | "run.failed",
    runId: string,
  ): Promise<void>;
  emitRunPausedTx(
    tx: TTx,
    opts: {
      runId: string;
      reason: string;
      approvalId?: string;
      detail?: string;
    },
  ): Promise<void>;
  emitRunCancelledTx(tx: TTx, opts: { runId: string; reason?: string }): Promise<void>;
}

export interface ResumeTokenRow {
  tenant_id: string;
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

export interface RunnableRunRow {
  tenant_id: string;
  run_id: string;
  job_id: string;
  agent_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
  workspace_id: string;
  policy_snapshot_id: string | null;
}

export interface StepRow {
  tenant_id: string;
  step_id: string;
  run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: string | null;
  max_attempts: number;
  timeout_ms: number;
}
