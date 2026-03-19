import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
} from "@tyrum/contracts";
import type { RedactionEngine } from "../../redaction/engine.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SecretProvider } from "../../secret/provider.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { createSecretHandleResolver } from "../../secret/handle-resolver.js";
import type { SqlDb } from "../../../statestore/types.js";
import { ExecutionEngineApprovalManager } from "./approval-manager.js";
import { ExecutionAttemptRunner, type ExecuteAttemptOptions } from "./attempt-runner.js";
import { defaultClock } from "./clock.js";
import { ExecutionEngineArtifactRecorder } from "./artifact-recorder.js";
import { executeWithTimeout as executeWithTimeoutFn } from "./concurrency-manager.js";
import { ExecutionEngineEventEmitter } from "./event-emitter.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
import type {
  ClockFn,
  EnqueuePlanInput,
  EnqueuePlanResult,
  ExecutionConcurrencyLimits,
  StepExecutionContext,
  StepExecutor,
  StepResult,
  WorkerTickInput,
} from "./types.js";
import { listRunnableRunCandidates, tryAcquireRunLaneLease } from "./leasing.js";
import { enqueuePlan, enqueuePlanInTx } from "./queueing.js";
import { cancelRun, resumeRun } from "./run-control.js";
import { claimStepExecution } from "./step-execution.js";
import { maybePauseForToolIntentGuardrailTx } from "./execution-engine-intent-guardrail.js";

export class ExecutionEngine {
  private readonly db: SqlDb;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly secretProviderForTenant?: (tenantId: string) => SecretProvider;
  private readonly logger?: Logger;
  private readonly policyService?: PolicyService;
  private readonly eventsEnabled: boolean;
  private readonly eventEmitter: ExecutionEngineEventEmitter;
  private readonly artifactRecorder: ExecutionEngineArtifactRecorder;
  private readonly approvalManager: ExecutionEngineApprovalManager;
  private readonly attemptRunner: ExecutionAttemptRunner;
  private readonly concurrencyLimits?: ExecutionConcurrencyLimits;

  constructor(opts: {
    db: SqlDb;
    clock?: ClockFn;
    redactionEngine?: RedactionEngine;
    secretProviderForTenant?: (tenantId: string) => SecretProvider;
    logger?: Logger;
    policyService?: PolicyService;
    eventsEnabled?: boolean;
    concurrencyLimits?: ExecutionConcurrencyLimits;
  }) {
    this.db = opts.db;
    this.clock = opts.clock ?? defaultClock;
    this.redactionEngine = opts.redactionEngine;
    this.secretProviderForTenant = opts.secretProviderForTenant;
    this.logger = opts.logger;
    this.policyService = opts.policyService;
    this.eventsEnabled = opts.eventsEnabled ?? true;
    this.concurrencyLimits = opts.concurrencyLimits;
    this.eventEmitter = new ExecutionEngineEventEmitter({
      clock: this.clock,
      eventsEnabled: this.eventsEnabled,
    });
    this.artifactRecorder = new ExecutionEngineArtifactRecorder({
      eventEmitter: this.eventEmitter,
      redactUnknown: (value) => this.redactUnknown(value),
    });
    this.approvalManager = new ExecutionEngineApprovalManager({
      clock: this.clock,
      logger: this.logger,
      policyService: this.policyService,
      redactText: (value) => this.redactText(value),
      redactUnknown: (value) => this.redactUnknown(value),
      eventEmitter: this.eventEmitter,
    });
    this.attemptRunner = new ExecutionAttemptRunner({
      db: this.db,
      clock: this.clock,
      logger: this.logger,
      policyService: this.policyService,
      concurrencyLimits: this.concurrencyLimits,
      redactText: (text) => this.redactText(text),
      redactUnknown: (value) => this.redactUnknown(value),
      executeWithTimeout: async (...args) => await this.executeWithTimeout(...args),
      resolveSecretScopesFromArgs: async (tenantId, args, context) =>
        await this.resolveSecretScopesFromArgs(tenantId, args, context),
      retryOrFailStep: async (retryOptions) =>
        await this.approvalManager.maybeRetryOrFailStep(retryOptions),
      pauseRunForApproval: async (tx, pauseOptions, input) =>
        await this.approvalManager.pauseRunForApproval(tx, pauseOptions, input),
      recordArtifactsTx: async (tx, scope, artifacts) =>
        await this.recordArtifactsTx(tx, scope, artifacts),
      emitAttemptUpdatedTx: async (tx, attemptId) => await this.emitAttemptUpdatedTx(tx, attemptId),
      emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
    });
  }

  private redactUnknown<T>(value: T): T {
    return this.redactionEngine ? (this.redactionEngine.redactUnknown(value).redacted as T) : value;
  }

  private redactText(text: string): string {
    return this.redactionEngine ? this.redactionEngine.redactText(text).redacted : text;
  }

  private async resolveSecretScopesFromArgs(
    tenantId: string,
    args: unknown,
    context?: { runId?: string; stepId?: string; attemptId?: string },
  ): Promise<string[]> {
    const handleIds = collectSecretHandleIds(args);
    if (handleIds.length === 0) return [];

    const secretProvider = this.secretProviderForTenant?.(tenantId);
    if (!secretProvider) {
      return handleIds;
    }

    try {
      return await createSecretHandleResolver(secretProvider).resolveScopes(handleIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("execution.secret_provider_list_failed", {
        tenant_id: tenantId,
        run_id: context?.runId,
        step_id: context?.stepId,
        attempt_id: context?.attemptId,
        error: message,
      });
      return handleIds;
    }
  }

  private async isApprovedPolicyGateTx(
    tx: SqlDb,
    tenantId: string,
    approvalId: string | null,
  ): Promise<boolean> {
    if (approvalId === null) return false;
    const row = await tx.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE tenant_id = ? AND approval_id = ? LIMIT 1",
      [tenantId, approvalId],
    );
    if (!row) return false;
    return row.kind === "policy" && row.status === "approved";
  }

  private async emitRunUpdatedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.eventEmitter.emitRunUpdatedTx(tx, runId);
  }
  private async emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void> {
    await this.eventEmitter.emitStepUpdatedTx(tx, stepId);
  }
  private async emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void> {
    await this.eventEmitter.emitAttemptUpdatedTx(tx, attemptId);
  }
  private async emitRunIdEventTx(
    tx: SqlDb,
    type: "run.queued" | "run.started" | "run.resumed" | "run.completed" | "run.failed",
    runId: string,
  ): Promise<void> {
    await this.eventEmitter.emitRunIdEventTx(tx, type, runId);
  }
  private async emitRunQueuedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.queued", runId);
  }
  private async emitRunStartedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.started", runId);
  }
  private async emitRunResumedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.resumed", runId);
  }
  private async emitRunCompletedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.completed", runId);
  }
  private async emitRunFailedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.failed", runId);
  }
  private async emitRunCancelledTx(
    tx: SqlDb,
    opts: { runId: string; reason?: string },
  ): Promise<void> {
    await this.eventEmitter.emitRunCancelledTx(tx, opts);
  }
  private async recordArtifactsTx(
    tx: SqlDb,
    scope: {
      tenantId: string;
      runId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      agentId: string | null;
    },
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    await this.artifactRecorder.recordArtifactsTx(tx, scope, artifacts);
  }

  async enqueuePlanInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlanInTx(
      {
        db: this.db,
        logger: this.logger,
        emitRunUpdatedTx: async (innerTx, runId) => await this.emitRunUpdatedTx(innerTx, runId),
        emitRunQueuedTx: async (innerTx, runId) => await this.emitRunQueuedTx(innerTx, runId),
        emitStepUpdatedTx: async (innerTx, stepId) => await this.emitStepUpdatedTx(innerTx, stepId),
        emitAttemptUpdatedTx: async (innerTx, attemptId) =>
          await this.emitAttemptUpdatedTx(innerTx, attemptId),
      },
      tx,
      input,
    );
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlan(
      {
        db: this.db,
        logger: this.logger,
        emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
        emitRunQueuedTx: async (tx, runId) => await this.emitRunQueuedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.emitAttemptUpdatedTx(tx, attemptId),
      },
      input,
    );
  }

  /**
   * Resume a paused run using an opaque token.
   *
   * Returns the resumed run id on success, otherwise `undefined`.
   */
  async resumeRun(token: string): Promise<string | undefined> {
    return await resumeRun(
      {
        db: this.db,
        clock: this.clock,
        redactText: (text) => this.redactText(text),
        concurrencyLimits: this.concurrencyLimits,
        emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.emitAttemptUpdatedTx(tx, attemptId),
        emitRunResumedTx: async (tx, runId) => await this.emitRunResumedTx(tx, runId),
        emitRunCancelledTx: async (tx, opts) => await this.emitRunCancelledTx(tx, opts),
      },
      token,
    );
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    return await cancelRun(
      {
        db: this.db,
        clock: this.clock,
        redactText: (text) => this.redactText(text),
        concurrencyLimits: this.concurrencyLimits,
        emitRunUpdatedTx: async (tx, runIdValue) => await this.emitRunUpdatedTx(tx, runIdValue),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.emitAttemptUpdatedTx(tx, attemptId),
        emitRunResumedTx: async (tx, runIdValue) => await this.emitRunResumedTx(tx, runIdValue),
        emitRunCancelledTx: async (tx, opts) => await this.emitRunCancelledTx(tx, opts),
      },
      runId,
      reason,
    );
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();
    const candidates = await listRunnableRunCandidates(this.db, input.runId);

    for (const run of candidates) {
      const leaseOk = await tryAcquireRunLaneLease(this.db, run, input.workerId, nowMs);
      if (!leaseOk) continue;

      try {
        const outcome = await claimStepExecution(
          {
            db: this.db,
            logger: this.logger,
            policyService: this.policyService,
            approvalManager: this.approvalManager,
            concurrencyLimits: this.concurrencyLimits,
            redactText: (text) => this.redactText(text),
            redactUnknown: (value) => this.redactUnknown(value),
            emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
            emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
            emitAttemptUpdatedTx: async (tx, attemptId) =>
              await this.emitAttemptUpdatedTx(tx, attemptId),
            emitRunStartedTx: async (tx, runId) => await this.emitRunStartedTx(tx, runId),
            emitRunCompletedTx: async (tx, runId) => await this.emitRunCompletedTx(tx, runId),
            emitRunFailedTx: async (tx, runId) => await this.emitRunFailedTx(tx, runId),
            isApprovedPolicyGateTx: async (tx, tenantId, approvalId) =>
              await this.isApprovedPolicyGateTx(tx, tenantId, approvalId),
            resolveSecretScopesFromArgs: async (tenantId, args, context) =>
              await this.resolveSecretScopesFromArgs(tenantId, args, context),
            maybePauseForToolIntentGuardrailTx: async (tx, opts) =>
              await maybePauseForToolIntentGuardrailTx(
                { logger: this.logger, approvalManager: this.approvalManager },
                tx,
                opts,
              ),
          },
          run,
          input.workerId,
          { nowMs, nowIso },
        );
        const didWork = await this.executeClaimedStep(outcome, input);
        if (didWork) return true;
      } finally {
        // Lane leases are held across the whole run while it's active.
        // The tick function releases on completion/failure. On transient
        // errors we still keep the lease for a short TTL to reduce stampedes.
      }
    }

    return false;
  }

  private async executeClaimedStep(
    outcome: Awaited<ReturnType<typeof claimStepExecution>>,
    input: WorkerTickInput,
  ): Promise<boolean> {
    if (outcome.kind === "noop") return false;
    if (outcome.kind === "recovered") return true;
    if (outcome.kind === "finalized") return true;
    if (outcome.kind === "idempotent") return true;
    if (outcome.kind === "cancelled") return true;
    if (outcome.kind === "paused") return true;

    const planId = parsePlanIdFromTriggerJson(outcome.triggerJson) ?? outcome.runId;

    const action = JSON.parse(outcome.step.action_json) as ActionPrimitiveT;
    const timeoutMs = Math.max(1, outcome.step.timeout_ms);

    return await this.executeAttempt({
      planId,
      stepIndex: outcome.step.step_index,
      action,
      postconditionJson: outcome.step.postcondition_json,
      maxAttempts: outcome.step.max_attempts,
      timeoutMs,
      tenantId: outcome.tenantId,
      runId: outcome.runId,
      jobId: outcome.jobId,
      agentId: outcome.agentId,
      workspaceId: outcome.workspaceId,
      key: outcome.key,
      lane: outcome.lane,
      stepId: outcome.step.step_id,
      attemptId: outcome.attempt.attemptId,
      attemptNum: outcome.attempt.attemptNum,
      workerId: input.workerId,
      executor: input.executor,
    });
  }

  private async executeAttempt(opts: ExecuteAttemptOptions): Promise<boolean> {
    return await this.attemptRunner.executeAttempt(opts);
  }

  private async executeWithTimeout(
    executor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    return await executeWithTimeoutFn(executor, action, planId, stepIndex, timeoutMs, context);
  }
}
