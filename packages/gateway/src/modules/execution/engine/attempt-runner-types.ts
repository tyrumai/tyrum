import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
} from "@tyrum/schemas";
import type { SqlDb } from "../../../statestore/types.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import type {
  MaybeRetryOrFailStepOpts,
  PauseRunForApprovalInput,
  PauseRunForApprovalOpts,
} from "./approval-manager.js";
import type {
  ClockFn,
  ExecutionConcurrencyLimits,
  StepExecutionContext,
  StepExecutor,
  StepResult,
} from "./types.js";

export type PauseRunForApprovalFn = (
  tx: SqlDb,
  opts: PauseRunForApprovalOpts,
  input: PauseRunForApprovalInput,
) => Promise<{ approvalId: string; resumeToken: string }>;

export type RecordArtifactsScope = {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  workspaceId: string;
  agentId: string | null;
};

export type RecordArtifactsFn = (
  tx: SqlDb,
  scope: RecordArtifactsScope,
  artifacts: ArtifactRefT[],
) => Promise<void>;

export type AttemptOutcome =
  | { kind: "paused"; reason: string; approvalId: string }
  | { kind: "succeeded" }
  | { kind: "cancelled" }
  | { kind: "failed"; status: string; error: string };

export type AttemptPolicyContext = Pick<
  ExecuteAttemptOptions,
  "action" | "agentId" | "attemptId" | "runId" | "stepId" | "tenantId" | "workspaceId"
>;

export type AttemptStatusContext = Pick<
  ExecuteAttemptOptions,
  "attemptId" | "tenantId" | "key" | "lane" | "workspaceId" | "workerId"
>;

export interface ExecutionAttemptRunnerOptions {
  db: SqlDb;
  clock: ClockFn;
  logger?: Logger;
  policyService?: PolicyService;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  redactText: (text: string) => string;
  redactUnknown: <T>(value: T) => T;
  executeWithTimeout: (
    executor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ) => Promise<StepResult>;
  resolveSecretScopesFromArgs: (
    tenantId: string,
    args: unknown,
    context?: { runId?: string; stepId?: string; attemptId?: string },
  ) => Promise<string[]>;
  retryOrFailStep: (opts: MaybeRetryOrFailStepOpts) => Promise<boolean>;
  pauseRunForApproval: PauseRunForApprovalFn;
  recordArtifactsTx: RecordArtifactsFn;
  emitAttemptUpdatedTx: (tx: SqlDb, attemptId: string) => Promise<void>;
  emitStepUpdatedTx: (tx: SqlDb, stepId: string) => Promise<void>;
}

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
  lane: string;
  stepId: string;
  attemptId: string;
  attemptNum: number;
  workerId: string;
  executor: StepExecutor;
}

export interface PreparedAttemptResult {
  result: StepResult;
  artifacts: ArtifactRefT[];
  artifactsJson: string;
  cost: Record<string, unknown>;
  costJson: string;
  evidenceJson: string | null;
  pauseDetail?: string;
  postconditionError?: string;
  postconditionReportJson: string | null;
  wallDurationMs: number;
}
