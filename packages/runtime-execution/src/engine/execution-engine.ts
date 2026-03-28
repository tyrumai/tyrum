import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import { parsePlanIdFromTriggerJson } from "./db.js";
import { enqueuePlan, enqueuePlanInTx } from "./queueing.js";
import { cancelRun, resumeRun } from "./run-control.js";
import type {
  ClockFn,
  EnqueuePlanInput,
  EnqueuePlanResult,
  ExecutionClock,
  ExecutionConcurrencyLimits,
  ExecutionDb,
  ExecutionEngineLogger,
  ExecutionTurnEventPort,
  ExecutionScopeResolver,
  ExecuteAttemptOptions,
  RunnableRunRow,
  StepClaimOutcome,
  WorkerTickInput,
} from "./types.js";

export function defaultExecutionClock(): ExecutionClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}

export interface ExecutionEngineOptions<
  TDb extends ExecutionDb<TDb>,
> extends ExecutionTurnEventPort<TDb> {
  db: TDb;
  clock?: ClockFn;
  logger?: ExecutionEngineLogger;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  scopeResolver: ExecutionScopeResolver<TDb>;
  releaseConcurrencySlotsTx(
    tx: TDb,
    tenantId: string,
    attemptId: string,
    nowIso: string,
    concurrencyLimits?: ExecutionConcurrencyLimits,
  ): Promise<void>;
  listRunnableRunCandidates(runId?: string): Promise<RunnableRunRow[]>;
  tryAcquireRunConversationLease(
    run: RunnableRunRow,
    workerId: string,
    nowMs: number,
  ): Promise<boolean>;
  claimStepExecution(
    run: RunnableRunRow,
    workerId: string,
    clock: ExecutionClock,
  ): Promise<StepClaimOutcome>;
  executeAttempt(opts: ExecuteAttemptOptions): Promise<boolean>;
  emitTurnQueuedTx(tx: TDb, runId: string): Promise<void>;
  emitTurnResumedTx(tx: TDb, runId: string): Promise<void>;
  emitTurnCancelledTx(tx: TDb, opts: { runId: string; reason?: string }): Promise<void>;
  redactText?(text: string): string;
}

export class ExecutionEngine<TDb extends ExecutionDb<TDb>> {
  private readonly clock: ClockFn;
  private readonly redactText: (text: string) => string;

  constructor(private readonly opts: ExecutionEngineOptions<TDb>) {
    this.clock = opts.clock ?? defaultExecutionClock;
    this.redactText = opts.redactText ?? ((text) => text);
  }

  async enqueuePlanInTx(tx: TDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlanInTx(
      {
        db: this.opts.db,
        logger: this.opts.logger,
        scopeResolver: this.opts.scopeResolver,
        emitTurnUpdatedTx: async (innerTx, runId) =>
          await this.opts.emitTurnUpdatedTx(innerTx, runId),
        emitTurnQueuedTx: async (innerTx, runId) =>
          await this.opts.emitTurnQueuedTx(innerTx, runId),
        emitStepUpdatedTx: async (innerTx, stepId) =>
          await this.opts.emitStepUpdatedTx(innerTx, stepId),
        emitAttemptUpdatedTx: async (innerTx, attemptId) =>
          await this.opts.emitAttemptUpdatedTx(innerTx, attemptId),
      },
      tx,
      input,
    );
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlan(
      {
        db: this.opts.db,
        logger: this.opts.logger,
        scopeResolver: this.opts.scopeResolver,
        emitTurnUpdatedTx: async (tx, runId) => await this.opts.emitTurnUpdatedTx(tx, runId),
        emitTurnQueuedTx: async (tx, runId) => await this.opts.emitTurnQueuedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.opts.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.opts.emitAttemptUpdatedTx(tx, attemptId),
      },
      input,
    );
  }

  async resumeRun(token: string): Promise<string | undefined> {
    return await resumeRun(
      {
        db: this.opts.db,
        clock: this.clock,
        redactText: this.redactText,
        concurrencyLimits: this.opts.concurrencyLimits,
        emitTurnUpdatedTx: async (tx, runId) => await this.opts.emitTurnUpdatedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.opts.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.opts.emitAttemptUpdatedTx(tx, attemptId),
        emitTurnResumedTx: async (tx, runId) => await this.opts.emitTurnResumedTx(tx, runId),
        emitTurnCancelledTx: async (tx, opts) => await this.opts.emitTurnCancelledTx(tx, opts),
        releaseConcurrencySlotsTx: async (tx, tenantId, attemptId, nowIso, limits) =>
          await this.opts.releaseConcurrencySlotsTx(tx, tenantId, attemptId, nowIso, limits),
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
        db: this.opts.db,
        clock: this.clock,
        redactText: this.redactText,
        concurrencyLimits: this.opts.concurrencyLimits,
        emitTurnUpdatedTx: async (tx, runIdValue) =>
          await this.opts.emitTurnUpdatedTx(tx, runIdValue),
        emitStepUpdatedTx: async (tx, stepId) => await this.opts.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) =>
          await this.opts.emitAttemptUpdatedTx(tx, attemptId),
        emitTurnResumedTx: async (tx, runIdValue) =>
          await this.opts.emitTurnResumedTx(tx, runIdValue),
        emitTurnCancelledTx: async (tx, opts) => await this.opts.emitTurnCancelledTx(tx, opts),
        releaseConcurrencySlotsTx: async (tx, tenantId, attemptId, nowIso, limits) =>
          await this.opts.releaseConcurrencySlotsTx(tx, tenantId, attemptId, nowIso, limits),
      },
      runId,
      reason,
    );
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();
    const candidates = await this.opts.listRunnableRunCandidates(input.runId);

    for (const run of candidates) {
      const leaseOk = await this.opts.tryAcquireRunConversationLease(run, input.workerId, nowMs);
      if (!leaseOk) continue;

      const outcome = await this.opts.claimStepExecution(run, input.workerId, { nowMs, nowIso });
      const didWork = await this.executeClaimedStep(outcome, input);
      if (didWork) return true;
    }

    return false;
  }

  private async executeClaimedStep(
    outcome: StepClaimOutcome,
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

    return await this.opts.executeAttempt({
      planId,
      stepIndex: outcome.step.step_index,
      action,
      postconditionJson: outcome.step.postcondition_json,
      maxAttempts: outcome.step.max_attempts,
      timeoutMs: Math.max(1, outcome.step.timeout_ms),
      tenantId: outcome.tenantId,
      runId: outcome.runId,
      jobId: outcome.jobId,
      agentId: outcome.agentId,
      workspaceId: outcome.workspaceId,
      key: outcome.key,
      stepId: outcome.step.step_id,
      attemptId: outcome.attempt.attemptId,
      attemptNum: outcome.attempt.attemptNum,
      workerId: input.workerId,
      executor: input.executor,
    });
  }
}
