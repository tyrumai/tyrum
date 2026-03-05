import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  EvaluationContext,
} from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
import type { SqlDb } from "../../../statestore/types.js";
import { safeJsonParse } from "../../../utils/json.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import { releaseWorkspaceLease } from "../../workspace/lease.js";
import type {
  MaybeRetryOrFailStepOpts,
  PauseRunForApprovalInput,
  PauseRunForApprovalOpts,
} from "./approval-manager.js";
import {
  releaseConcurrencySlotsTx,
  releaseLaneAndWorkspaceLeasesTx,
} from "./concurrency-manager.js";
import { toolCallFromAction } from "./tool-call.js";
import type {
  ClockFn,
  ExecutionConcurrencyLimits,
  StepExecutionContext,
  StepExecutor,
  StepResult,
} from "./types.js";

type PauseRunForApprovalFn = (
  tx: SqlDb,
  opts: PauseRunForApprovalOpts,
  input: PauseRunForApprovalInput,
) => Promise<{ approvalId: string; resumeToken: string }>;

type RecordArtifactsFn = (
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
) => Promise<void>;

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

interface PreparedAttemptResult {
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

type AttemptOutcome =
  | { kind: "paused"; reason: string; approvalId: string }
  | { kind: "succeeded" }
  | { kind: "cancelled" }
  | { kind: "failed"; status: string; error: string };

export class ExecutionAttemptRunner {
  constructor(
    private readonly opts: {
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
    },
  ) {}

  async executeAttempt(opts: ExecuteAttemptOptions): Promise<boolean> {
    const wallStartMs = Date.now();

    this.logAttemptStart(opts);
    await this.persistAttemptPolicyContext(opts).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("execution.attempt.policy_persist_failed", {
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        error: message,
      });
    });

    const context = await this.loadExecutionContext(opts);
    const result = await this.opts.executeWithTimeout(
      opts.executor,
      opts.action,
      opts.planId,
      opts.stepIndex,
      opts.timeoutMs,
      context,
    );
    const prepared = this.prepareAttemptResult(opts, result, wallStartMs);
    const outcome = await this.persistAttemptOutcome(opts, prepared);

    await this.releaseCliWorkspaceLease(opts);
    this.logAttemptOutcome(opts, prepared, outcome);
    return true;
  }

  private logAttemptStart(opts: ExecuteAttemptOptions): void {
    this.opts.logger?.info("execution.attempt.start", {
      plan_id: opts.planId,
      job_id: opts.jobId,
      run_id: opts.runId,
      step_id: opts.stepId,
      attempt_id: opts.attemptId,
      attempt: opts.attemptNum,
      key: opts.key,
      lane: opts.lane,
      worker_id: opts.workerId,
      step_index: opts.stepIndex,
      action_type: opts.action.type,
    });
  }

  private async loadExecutionContext(opts: ExecuteAttemptOptions): Promise<StepExecutionContext> {
    const approvalRow = await this.opts.db.get<{ approval_id: string | null }>(
      "SELECT approval_id FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [opts.tenantId, opts.stepId],
    );
    const runPolicy = await this.opts.db.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [opts.tenantId, opts.runId],
    );

    return {
      tenantId: opts.tenantId,
      runId: opts.runId,
      stepId: opts.stepId,
      attemptId: opts.attemptId,
      approvalId: approvalRow?.approval_id ?? null,
      key: opts.key,
      lane: opts.lane,
      workspaceId: opts.workspaceId,
      policySnapshotId: runPolicy?.policy_snapshot_id ?? null,
    };
  }

  private prepareAttemptResult(
    opts: ExecuteAttemptOptions,
    result: StepResult,
    wallStartMs: number,
  ): PreparedAttemptResult {
    const wallDurationMs = Math.max(0, Date.now() - wallStartMs);
    const evidenceJson =
      result.evidence !== undefined
        ? JSON.stringify(this.opts.redactUnknown(result.evidence))
        : null;
    const artifacts = safeJsonParse(
      JSON.stringify(this.opts.redactUnknown(result.artifacts ?? [])),
      [] as ArtifactRefT[],
    );
    const artifactsJson = JSON.stringify(artifacts);
    const cost = this.opts.redactUnknown(
      result.cost
        ? { ...result.cost, duration_ms: result.cost.duration_ms ?? wallDurationMs }
        : { duration_ms: wallDurationMs },
    ) as Record<string, unknown>;

    const postcondition = this.evaluatePostconditionResult(result, opts.postconditionJson);
    return {
      result,
      artifacts,
      artifactsJson,
      cost,
      costJson: JSON.stringify(cost),
      evidenceJson,
      pauseDetail: postcondition.pauseDetail,
      postconditionError: postcondition.postconditionError,
      postconditionReportJson: postcondition.postconditionReportJson,
      wallDurationMs,
    };
  }

  private evaluatePostconditionResult(
    result: StepResult,
    postconditionJson: string | null,
  ): {
    pauseDetail?: string;
    postconditionError?: string;
    postconditionReportJson: string | null;
  } {
    let pauseDetail: string | undefined;
    let postconditionError: string | undefined;
    let postconditionReportJson: string | null = null;

    if (result.success && postconditionJson) {
      try {
        const spec = JSON.parse(postconditionJson) as unknown;
        const report = evaluatePostcondition(spec, result.evidence ?? ({} as EvaluationContext));
        postconditionReportJson = JSON.stringify(this.opts.redactUnknown(report));
        if (!report.passed) {
          postconditionError = "postcondition failed";
        }
      } catch (err) {
        if (err instanceof PostconditionError && err.kind === "missing_evidence") {
          pauseDetail = `postcondition missing evidence: ${err.message}`;
        } else if (err instanceof PostconditionError) {
          postconditionError = `postcondition error: ${err.message}`;
        } else {
          postconditionError = "postcondition error";
        }
      }
    }

    return { pauseDetail, postconditionError, postconditionReportJson };
  }

  private async persistAttemptOutcome(
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    return await this.opts.db.transaction(async (tx) => {
      const current = await tx.get<{ run_status: string; job_status: string }>(
        `SELECT r.status AS run_status, j.status AS job_status
         FROM execution_runs r
         JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
         WHERE r.tenant_id = ? AND r.run_id = ?`,
        [opts.tenantId, opts.runId],
      );
      const step = await tx.get<{ status: string }>(
        "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
        [opts.tenantId, opts.stepId],
      );

      const cancelled =
        current?.run_status === "cancelled" ||
        current?.job_status === "cancelled" ||
        step?.status === "cancelled";
      if (cancelled) {
        return await this.handleCancelledAttemptTx(tx, opts, prepared);
      }

      if (prepared.result.success) {
        return await this.handleSuccessfulAttemptTx(tx, opts, prepared);
      }

      return await this.handleFailedAttemptTx(tx, opts, prepared);
    });
  }

  private async handleCancelledAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    const nowIso = this.opts.clock().nowIso;

    await tx.run(
      `UPDATE execution_attempts
       SET status = 'cancelled',
           finished_at = COALESCE(finished_at, ?),
           error = COALESCE(error, 'cancelled'),
           metadata_json = COALESCE(metadata_json, ?),
           artifacts_json = COALESCE(artifacts_json, ?),
           cost_json = COALESCE(cost_json, ?)
       WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
      [
        nowIso,
        prepared.evidenceJson,
        prepared.artifactsJson,
        prepared.costJson,
        opts.tenantId,
        opts.attemptId,
      ],
    );
    await this.opts.emitAttemptUpdatedTx(tx, opts.attemptId);
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      nowIso,
      this.opts.concurrencyLimits,
    );
    await releaseLaneAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
      lane: opts.lane,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });
    return { kind: "cancelled" };
  }

  private async handleSuccessfulAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    if (prepared.result.pause) {
      return await this.pauseForExecutorApprovalTx(tx, opts, prepared);
    }
    if (prepared.pauseDetail) {
      return await this.pauseForTakeoverApprovalTx(tx, opts, prepared);
    }
    if (prepared.postconditionError) {
      return await this.failForPostconditionTx(tx, opts, prepared);
    }
    return await this.completeSuccessfulAttemptTx(tx, opts, prepared);
  }

  private async pauseForExecutorApprovalTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    await this.markAttemptSucceeded(
      tx,
      opts,
      prepared.result,
      prepared.evidenceJson,
      prepared.postconditionReportJson,
      prepared.artifactsJson,
      prepared.costJson,
    );
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);

    const paused = await this.opts.pauseRunForApproval(tx, opts, {
      kind: prepared.result.pause!.kind,
      prompt: prepared.result.pause!.prompt,
      detail: prepared.result.pause!.detail,
      context: prepared.result.pause!.context,
      expiresAt: prepared.result.pause!.expiresAt ?? undefined,
    });
    return { kind: "paused", reason: "approval", approvalId: paused.approvalId };
  }

  private async pauseForTakeoverApprovalTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    await this.markAttemptSucceeded(
      tx,
      opts,
      prepared.result,
      prepared.evidenceJson,
      null,
      prepared.artifactsJson,
      prepared.costJson,
    );
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);

    const paused = await this.opts.pauseRunForApproval(tx, opts, {
      kind: "takeover",
      prompt: "Takeover required to continue workflow",
      detail: prepared.pauseDetail!,
      context: {
        source: "execution-engine",
        run_id: opts.runId,
        job_id: opts.jobId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        action: opts.action,
      },
    });
    return { kind: "paused", reason: "takeover", approvalId: paused.approvalId };
  }

  private async failForPostconditionTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    const nowIso = this.opts.clock().nowIso;

    await this.markAttemptFailed(
      tx,
      opts,
      prepared.postconditionError!,
      prepared.evidenceJson,
      prepared.postconditionReportJson,
      prepared.artifactsJson,
      prepared.costJson,
    );
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);
    await this.opts.retryOrFailStep({
      tx,
      nowIso,
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      attemptNum: opts.attemptNum,
      maxAttempts: opts.maxAttempts,
      stepId: opts.stepId,
      attemptId: opts.attemptId,
      runId: opts.runId,
      jobId: opts.jobId,
      workspaceId: opts.workspaceId,
      key: opts.key,
      lane: opts.lane,
      workerId: opts.workerId,
    });
    return { kind: "failed", status: "failed", error: prepared.postconditionError! };
  }

  private async completeSuccessfulAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    await this.markAttemptSucceeded(
      tx,
      opts,
      prepared.result,
      prepared.evidenceJson,
      prepared.postconditionReportJson,
      prepared.artifactsJson,
      prepared.costJson,
    );
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);

    const stepUpdated = await tx.run(
      `UPDATE execution_steps
       SET status = 'succeeded'
       WHERE tenant_id = ? AND step_id = ? AND status = 'running'`,
      [opts.tenantId, opts.stepId],
    );
    if (stepUpdated.changes === 1) {
      await this.opts.emitStepUpdatedTx(tx, opts.stepId);
    }

    const idempotencyKey = opts.action.idempotency_key?.trim();
    if (idempotencyKey) {
      await this.persistIdempotencyRecordTx(tx, opts, prepared.result);
    }

    return { kind: "succeeded" };
  }

  private async persistIdempotencyRecordTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    result: StepResult,
  ): Promise<void> {
    const nowIso = this.opts.clock().nowIso;
    const resultJson =
      result.result !== undefined ? JSON.stringify(this.opts.redactUnknown(result.result)) : null;

    await tx.run(
      `INSERT INTO idempotency_records (
         tenant_id,
         scope_key,
         kind,
         idempotency_key,
         status,
         result_json,
         error,
         updated_at
       ) VALUES (?, ?, 'step', ?, 'succeeded', ?, NULL, ?)
       ON CONFLICT (tenant_id, scope_key, kind, idempotency_key) DO UPDATE SET
         status = excluded.status,
         result_json = excluded.result_json,
         error = NULL,
         updated_at = excluded.updated_at`,
      [opts.tenantId, opts.stepId, opts.action.idempotency_key!.trim(), resultJson, nowIso],
    );
  }

  private async handleFailedAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    const nowIso = this.opts.clock().nowIso;
    const error = prepared.result.error ?? "unknown error";
    const redactedError = this.opts.redactText(error);
    const timedOut = error.toLowerCase().includes("timed out");
    const status = timedOut ? "timed_out" : "failed";

    await tx.run(
      `UPDATE execution_attempts
       SET status = ?,
           finished_at = ?,
           result_json = NULL,
           error = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
      [
        status,
        nowIso,
        redactedError,
        prepared.evidenceJson,
        prepared.artifactsJson,
        prepared.costJson,
        opts.tenantId,
        opts.attemptId,
      ],
    );
    await this.opts.emitAttemptUpdatedTx(tx, opts.attemptId);
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      nowIso,
      this.opts.concurrencyLimits,
    );
    await this.opts.retryOrFailStep({
      tx,
      nowIso,
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      attemptNum: opts.attemptNum,
      maxAttempts: opts.maxAttempts,
      stepId: opts.stepId,
      attemptId: opts.attemptId,
      runId: opts.runId,
      jobId: opts.jobId,
      workspaceId: opts.workspaceId,
      key: opts.key,
      lane: opts.lane,
      workerId: opts.workerId,
    });
    return { kind: "failed", status, error: redactedError };
  }

  private async recordAttemptArtifactsTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    await this.opts.recordArtifactsTx(
      tx,
      {
        tenantId: opts.tenantId,
        runId: opts.runId,
        stepId: opts.stepId,
        attemptId: opts.attemptId,
        workspaceId: opts.workspaceId,
        agentId: opts.agentId,
      },
      artifacts,
    );
  }

  private async persistAttemptPolicyContext(
    opts: Pick<
      ExecuteAttemptOptions,
      "action" | "agentId" | "attemptId" | "runId" | "stepId" | "tenantId" | "workspaceId"
    >,
  ): Promise<void> {
    const run = await this.opts.db.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [opts.tenantId, opts.runId],
    );
    const policySnapshotId = run?.policy_snapshot_id?.trim() ?? "";
    if (!policySnapshotId) return;

    await this.opts.db.run(
      `UPDATE execution_attempts
       SET policy_snapshot_id = ?
       WHERE tenant_id = ? AND attempt_id = ?`,
      [policySnapshotId, opts.tenantId, opts.attemptId],
    );

    if (!this.opts.policyService?.isEnabled()) return;

    const tool = toolCallFromAction(opts.action);
    const secretScopes = await this.opts.resolveSecretScopesFromArgs(
      opts.tenantId,
      opts.action.args ?? {},
      {
        runId: opts.runId,
        stepId: opts.stepId,
        attemptId: opts.attemptId,
      },
    );
    const evaluation = await this.opts.policyService.evaluateToolCallFromSnapshot({
      tenantId: opts.tenantId,
      policySnapshotId,
      agentId: opts.agentId,
      workspaceId: opts.workspaceId,
      toolId: tool.toolId,
      toolMatchTarget: tool.matchTarget,
      url: tool.url,
      secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
      inputProvenance: { source: "workflow", trusted: true },
    });

    await this.opts.db.run(
      `UPDATE execution_attempts
       SET policy_decision_json = ?,
           policy_applied_override_ids_json = ?
       WHERE tenant_id = ? AND attempt_id = ?`,
      [
        JSON.stringify(evaluation.decision_record ?? { decision: evaluation.decision, rules: [] }),
        JSON.stringify(evaluation.applied_override_ids ?? []),
        opts.tenantId,
        opts.attemptId,
      ],
    );
  }

  private async markAttemptSucceeded(
    tx: SqlDb,
    opts: Pick<ExecuteAttemptOptions, "attemptId" | "tenantId">,
    result: StepResult,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const nowIso = this.opts.clock().nowIso;
    const resultJson =
      result.result !== undefined ? JSON.stringify(this.opts.redactUnknown(result.result)) : null;

    await tx.run(
      `UPDATE execution_attempts
       SET status = 'succeeded',
           finished_at = ?,
           result_json = ?,
           error = NULL,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
      [
        nowIso,
        resultJson,
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.tenantId,
        opts.attemptId,
      ],
    );
    await this.opts.emitAttemptUpdatedTx(tx, opts.attemptId);
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      nowIso,
      this.opts.concurrencyLimits,
    );
  }

  private async markAttemptFailed(
    tx: SqlDb,
    opts: Pick<ExecuteAttemptOptions, "attemptId" | "tenantId">,
    error: string,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const nowIso = this.opts.clock().nowIso;

    await tx.run(
      `UPDATE execution_attempts
       SET status = 'failed',
           finished_at = ?,
           result_json = NULL,
           error = ?,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
      [
        nowIso,
        this.opts.redactText(error),
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.tenantId,
        opts.attemptId,
      ],
    );
    await this.opts.emitAttemptUpdatedTx(tx, opts.attemptId);
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      nowIso,
      this.opts.concurrencyLimits,
    );
  }

  private async releaseCliWorkspaceLease(opts: ExecuteAttemptOptions): Promise<void> {
    if (opts.action.type !== "CLI") return;
    await releaseWorkspaceLease(this.opts.db, {
      tenantId: opts.tenantId,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("execution.workspace_lease_release_failed", {
        workspace_id: opts.workspaceId,
        worker_id: opts.workerId,
        error: message,
      });
    });
  }

  private logAttemptOutcome(
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
    outcome: AttemptOutcome,
  ): void {
    if (outcome.kind === "paused") {
      this.opts.logger?.info("execution.attempt.paused", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        reason: outcome.reason,
        approval_id: outcome.approvalId,
      });
      return;
    }

    if (outcome.kind === "succeeded") {
      this.opts.logger?.info("execution.attempt.succeeded", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        status: "succeeded",
        duration_ms: prepared.wallDurationMs,
        cost: prepared.cost,
      });
      return;
    }

    if (outcome.kind === "cancelled") {
      this.opts.logger?.info("execution.attempt.cancelled", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        status: "cancelled",
      });
      return;
    }

    this.opts.logger?.info("execution.attempt.failed", {
      job_id: opts.jobId,
      run_id: opts.runId,
      step_id: opts.stepId,
      attempt_id: opts.attemptId,
      status: outcome.status,
      error: outcome.error,
      duration_ms: prepared.wallDurationMs,
      cost: prepared.cost,
    });
  }
}
