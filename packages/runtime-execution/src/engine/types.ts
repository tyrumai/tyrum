import type {
  ActionPrimitive as ActionPrimitiveT,
  ApprovalKind as ApprovalKindT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
  ClientCapability as ClientCapabilityT,
  EvaluationContext,
  ExecutionBudgets as ExecutionBudgetsT,
  TurnTrigger as TurnTriggerT,
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

export interface ExecutionRunResult {
  changes: number;
}

export interface ExecutionDb<TTx = unknown> {
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  run(sql: string, params?: readonly unknown[]): Promise<ExecutionRunResult>;
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

export interface ExecutionEngineLogger {
  info?(message: string, attributes?: Record<string, unknown>): void;
  warn?(message: string, attributes?: Record<string, unknown>): void;
}

export interface StepExecutionContext {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  approvalId: string | null;
  agentId?: string | null;
  key: string;
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
  /** Explicit retained conversation linkage for conversation-backed runs. */
  conversationId?: string;
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
  trigger?: TurnTriggerT;
}

export interface EnqueuePlanResult {
  jobId: string;
  runId: string;
}

export interface ExecutionScopeResolver<TTx> {
  resolveExecutionAgentId(tx: TTx, tenantId: string, key: string): Promise<string>;
  resolveWorkspaceId(tx: TTx, tenantId: string, input: EnqueuePlanInput): Promise<string>;
  ensureMembership(tx: TTx, tenantId: string, agentId: string, workspaceId: string): Promise<void>;
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

export interface ExecutionTurnEventPort<TTx> {
  emitTurnUpdatedTx(tx: TTx, runId: string): Promise<void>;
  emitStepUpdatedTx(tx: TTx, stepId: string): Promise<void>;
  emitAttemptUpdatedTx(tx: TTx, attemptId: string): Promise<void>;
}

export interface ExecutionEventPort<
  TTx,
  TEvent = unknown,
  TMessage = TEvent,
  TAudience = unknown,
> extends ExecutionTurnEventPort<TTx> {
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
  emitTurnLifecycleEventTx(
    tx: TTx,
    type: "turn.queued" | "turn.started" | "turn.resumed" | "turn.completed" | "turn.failed",
    runId: string,
  ): Promise<void>;
  emitTurnBlockedTx(
    tx: TTx,
    opts: {
      runId: string;
      reason: string;
      approvalId?: string;
      detail?: string;
    },
  ): Promise<void>;
  emitTurnCancelledTx(tx: TTx, opts: { runId: string; reason?: string }): Promise<void>;
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

export type StepClaimOutcome =
  | { kind: "noop" }
  | { kind: "recovered" }
  | { kind: "finalized" }
  | { kind: "idempotent" }
  | { kind: "cancelled" }
  | { kind: "paused"; reason: "budget" | "policy" | "approval"; approvalId: string }
  | {
      kind: "claimed";
      tenantId: string;
      agentId: string;
      runId: string;
      jobId: string;
      workspaceId: string;
      key: string;
      triggerJson: string;
      step: StepRow;
      attempt: {
        attemptId: string;
        attemptNum: number;
      };
    };

export interface ExecuteAttemptOptions {
  planId: string;
  stepIndex: number;
  action: ActionPrimitiveT;
  postconditionJson: string | null;
  maxAttempts: number;
  timeoutMs: number;
  tenantId: string;
  runId: string;
  jobId: string;
  agentId: string;
  workspaceId: string;
  key: string;
  stepId: string;
  attemptId: string;
  attemptNum: number;
  workerId: string;
  executor: StepExecutor;
}
