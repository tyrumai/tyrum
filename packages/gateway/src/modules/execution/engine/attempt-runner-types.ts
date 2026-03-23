import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
} from "@tyrum/contracts";
import type { ExecuteAttemptOptions } from "@tyrum/runtime-execution";
import type { SqlDb } from "../../../statestore/types.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type {
  ClockFn,
  ExecutionApprovalPort,
  ExecutionArtifactPort,
  ExecutionConcurrencyLimits,
  ExecutionMaybeRetryOrFailStepOptions,
  StepExecutionContext,
  StepExecutor,
  StepResult,
} from "./types.js";

export type PauseRunForApprovalFn = ExecutionApprovalPort<SqlDb>["pauseRunForApproval"];

export type RecordArtifactsFn = ExecutionArtifactPort<SqlDb>["recordArtifactsTx"];

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
  retryOrFailStep: (opts: ExecutionMaybeRetryOrFailStepOptions<SqlDb>) => Promise<boolean>;
  pauseRunForApproval: PauseRunForApprovalFn;
  recordArtifactsTx: RecordArtifactsFn;
  emitAttemptUpdatedTx: (tx: SqlDb, attemptId: string) => Promise<void>;
  emitStepUpdatedTx: (tx: SqlDb, stepId: string) => Promise<void>;
}
export type { ExecuteAttemptOptions } from "@tyrum/runtime-execution";

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
