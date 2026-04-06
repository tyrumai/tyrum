import type {
  ActionPrimitive as ActionPrimitiveT,
  ApprovalKind as ApprovalKindT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
  ClientCapability as ClientCapabilityT,
  EvaluationContext,
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

export interface StepExecutionContext {
  tenantId: string;
  turnId: string;
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

export interface WorkerTickInput {
  workerId: string;
  executor: StepExecutor;
  turnId?: string;
}

export interface ExecutionConcurrencyLimits {
  global?: number;
  perAgent?: number;
  perCapability?: Partial<Record<ClientCapabilityT, number>>;
}
