import type { ArtifactRef as ArtifactRefT, EvaluationContext } from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
import type { SqlDb } from "../../../statestore/types.js";
import { safeJsonParse } from "../../../utils/json.js";
import { releaseWorkspaceLease } from "../../workspace/lease.js";
import type { PauseRunForApprovalInput } from "./approval-manager.js";
import {
  releaseConcurrencySlotsTx,
  releaseLaneAndWorkspaceLeasesTx,
} from "./concurrency-manager.js";
import type { StepExecutionContext, StepResult } from "./types.js";
import type {
  AttemptOutcome,
  AttemptStatusContext,
  ExecuteAttemptOptions,
  ExecutionAttemptRunnerOptions,
  PreparedAttemptResult,
} from "./attempt-runner-types.js";
import {
  persistAttemptPolicyContext,
  logAttemptStart,
  logAttemptOutcome,
} from "./attempt-runner-helpers.js";

export type { ExecuteAttemptOptions } from "./attempt-runner-types.js";

export class ExecutionAttemptRunner {
  constructor(private readonly opts: ExecutionAttemptRunnerOptions) {}

  async executeAttempt(opts: ExecuteAttemptOptions): Promise<boolean> {
    const wallStartMs = Date.now();
    logAttemptStart(this.opts.logger, opts);
    await persistAttemptPolicyContext(
      {
        db: this.opts.db,
        policyService: this.opts.policyService,
        resolveSecretScopesFromArgs: this.opts.resolveSecretScopesFromArgs,
      },
      opts,
    ).catch((err) => {
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
    logAttemptOutcome(this.opts.logger, opts, prepared, outcome);
    return true;
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
    return {
      result,
      artifacts,
      artifactsJson,
      cost,
      costJson: JSON.stringify(cost),
      evidenceJson,
      wallDurationMs,
      ...this.evaluatePostconditionResult(result, opts.postconditionJson),
    };
  }

  private evaluatePostconditionResult(
    result: StepResult,
    postconditionJson: string | null,
  ): Pick<PreparedAttemptResult, "pauseDetail" | "postconditionError" | "postconditionReportJson"> {
    if (!result.success || !postconditionJson) return { postconditionReportJson: null };
    try {
      const report = evaluatePostcondition(
        JSON.parse(postconditionJson) as unknown,
        result.evidence ?? ({} as EvaluationContext),
      );
      return {
        postconditionReportJson: JSON.stringify(this.opts.redactUnknown(report)),
        postconditionError: report.passed ? undefined : "postcondition failed",
      };
    } catch (err) {
      if (err instanceof PostconditionError && err.kind === "missing_evidence")
        return {
          pauseDetail: `postcondition missing evidence: ${err.message}`,
          postconditionReportJson: null,
        };
      return {
        postconditionError:
          err instanceof PostconditionError
            ? `postcondition error: ${err.message}`
            : "postcondition error",
        postconditionReportJson: null,
      };
    }
  }

  private async persistAttemptOutcome(
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    return this.opts.db.transaction(async (tx) => {
      const current = await tx.get<{ run_status: string; job_status: string }>(
        `SELECT r.status AS run_status, j.status AS job_status FROM execution_runs r
         JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
         WHERE r.tenant_id = ? AND r.run_id = ?`,
        [opts.tenantId, opts.runId],
      );
      const step = await tx.get<{ status: string }>(
        "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
        [opts.tenantId, opts.stepId],
      );
      if (
        current?.run_status === "cancelled" ||
        current?.job_status === "cancelled" ||
        step?.status === "cancelled"
      )
        return this.handleCancelledAttemptTx(tx, opts, prepared);
      return prepared.result.success
        ? this.handleSuccessfulAttemptTx(tx, opts, prepared)
        : this.handleFailedAttemptTx(tx, opts, prepared);
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
       SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = COALESCE(error, 'cancelled'),
           metadata_json = COALESCE(metadata_json, ?), artifacts_json = COALESCE(artifacts_json, ?), cost_json = COALESCE(cost_json, ?)
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
    await this.emitAndReleaseAttemptTx(tx, opts, nowIso, true);
    return { kind: "cancelled" };
  }

  private async handleSuccessfulAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    const pause = prepared.result.pause;
    if (pause) {
      return this.pauseSuccessfulAttemptTx(
        tx,
        opts,
        prepared,
        {
          kind: pause.kind,
          prompt: pause.prompt,
          detail: pause.detail,
          context: pause.context,
          expiresAt: pause.expiresAt ?? undefined,
        },
        "approval",
        prepared.postconditionReportJson,
      );
    }
    if (prepared.pauseDetail) {
      return this.pauseSuccessfulAttemptTx(
        tx,
        opts,
        prepared,
        {
          kind: "takeover",
          prompt: "Takeover required to continue workflow",
          detail: prepared.pauseDetail,
          context: {
            source: "execution-engine",
            run_id: opts.runId,
            job_id: opts.jobId,
            step_id: opts.stepId,
            attempt_id: opts.attemptId,
            action: opts.action,
          },
        },
        "takeover",
        null,
      );
    }
    if (prepared.postconditionError) return this.failForPostconditionTx(tx, opts, prepared);
    return this.completeSuccessfulAttemptTx(tx, opts, prepared);
  }

  private async pauseSuccessfulAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
    input: PauseRunForApprovalInput,
    reason: "approval" | "takeover",
    postconditionReportJson: string | null,
  ): Promise<AttemptOutcome> {
    await this.markSuccessAndRecordArtifactsTx(tx, opts, prepared, postconditionReportJson);
    const paused = await this.opts.pauseRunForApproval(tx, opts, input);
    return { kind: "paused", reason, approvalId: paused.approvalId };
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
    await this.retryStepTx(tx, opts, nowIso);
    return { kind: "failed", status: "failed", error: prepared.postconditionError! };
  }

  private async completeSuccessfulAttemptTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
  ): Promise<AttemptOutcome> {
    await this.markSuccessAndRecordArtifactsTx(
      tx,
      opts,
      prepared,
      prepared.postconditionReportJson,
    );
    const stepUpdated = await tx.run(
      "UPDATE execution_steps SET status = 'succeeded' WHERE tenant_id = ? AND step_id = ? AND status = 'running'",
      [opts.tenantId, opts.stepId],
    );
    if (stepUpdated.changes === 1) await this.opts.emitStepUpdatedTx(tx, opts.stepId);
    if (opts.action.idempotency_key?.trim())
      await this.persistIdempotencyRecordTx(tx, opts, prepared.result);
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
      `INSERT INTO idempotency_records (tenant_id, scope_key, kind, idempotency_key, status, result_json, error, updated_at)
       VALUES (?, ?, 'step', ?, 'succeeded', ?, NULL, ?)
       ON CONFLICT (tenant_id, scope_key, kind, idempotency_key) DO UPDATE SET
         status = excluded.status, result_json = excluded.result_json, error = NULL, updated_at = excluded.updated_at`,
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
    const status = error.toLowerCase().includes("timed out") ? "timed_out" : "failed";
    await tx.run(
      `UPDATE execution_attempts
       SET status = ?, finished_at = ?, result_json = NULL, error = ?, metadata_json = ?, artifacts_json = ?, cost_json = ?
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
    await this.emitAndReleaseAttemptTx(tx, opts, nowIso);
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);
    await this.retryStepTx(
      tx,
      opts,
      nowIso,
      prepared.result.failureKind === "policy" ? opts.attemptNum : undefined,
    );
    return { kind: "failed", status, error: redactedError };
  }

  private async markSuccessAndRecordArtifactsTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    prepared: PreparedAttemptResult,
    postconditionReportJson: string | null,
  ): Promise<void> {
    await this.markAttemptSucceeded(
      tx,
      opts,
      prepared.result,
      prepared.evidenceJson,
      postconditionReportJson,
      prepared.artifactsJson,
      prepared.costJson,
    );
    await this.recordAttemptArtifactsTx(tx, opts, prepared.artifacts);
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

  private async retryStepTx(
    tx: SqlDb,
    opts: ExecuteAttemptOptions,
    nowIso: string,
    maxAttemptsOverride?: number,
  ): Promise<void> {
    await this.opts.retryOrFailStep({
      tx,
      nowIso,
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      attemptNum: opts.attemptNum,
      maxAttempts: maxAttemptsOverride ?? opts.maxAttempts,
      stepId: opts.stepId,
      attemptId: opts.attemptId,
      runId: opts.runId,
      jobId: opts.jobId,
      workspaceId: opts.workspaceId,
      key: opts.key,
      lane: opts.lane,
      workerId: opts.workerId,
    });
  }

  private async emitAndReleaseAttemptTx(
    tx: SqlDb,
    opts: AttemptStatusContext,
    nowIso: string,
    releaseLeases = false,
  ): Promise<void> {
    await this.opts.emitAttemptUpdatedTx(tx, opts.attemptId);
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      nowIso,
      this.opts.concurrencyLimits,
    );
    if (!releaseLeases) return;
    await releaseLaneAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
      lane: opts.lane,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });
  }

  private async markAttemptSucceeded(
    tx: SqlDb,
    opts: AttemptStatusContext,
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
       SET status = 'succeeded', finished_at = ?, result_json = ?, error = NULL, postcondition_report_json = ?, metadata_json = ?, artifacts_json = ?, cost_json = ?
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
    await this.emitAndReleaseAttemptTx(tx, opts, nowIso);
  }

  private async markAttemptFailed(
    tx: SqlDb,
    opts: AttemptStatusContext,
    error: string,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const nowIso = this.opts.clock().nowIso;
    await tx.run(
      `UPDATE execution_attempts
       SET status = 'failed', finished_at = ?, result_json = NULL, error = ?, postcondition_report_json = ?, metadata_json = ?, artifacts_json = ?, cost_json = ?
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
    await this.emitAndReleaseAttemptTx(tx, opts, nowIso);
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
}
