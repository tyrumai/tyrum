import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
} from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { RedactionEngine } from "../redaction/engine.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";

export interface StepResult {
  success: boolean;
  result?: unknown;
  error?: string;
  evidence?: EvaluationContext;
  artifacts?: ArtifactRefT[];
  cost?: AttemptCostT;
}

export interface StepExecutor {
  execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
  ): Promise<StepResult>;
}

export interface ExecutionClock {
  nowMs: number;
  nowIso: string;
}

export type ClockFn = () => ExecutionClock;

export interface EnqueuePlanInput {
  key: string;
  lane: string;
  planId: string;
  requestId: string;
  steps: ActionPrimitiveT[];
}

export interface EnqueuePlanResult {
  jobId: string;
  runId: string;
}

export interface WorkerTickInput {
  workerId: string;
  executor: StepExecutor;
}

interface ResumeTokenRow {
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

interface RunnableRunRow {
  run_id: string;
  job_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
}

interface StepRow {
  step_id: string;
  step_index: number;
  status: string;
  action_json: string;
  idempotency_key: string | null;
  postcondition_json: string | null;
  max_attempts: number;
  timeout_ms: number;
}

function defaultClock(): ExecutionClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}

function parsePlanIdFromTriggerJson(triggerJson: string): string | undefined {
  try {
    const parsed = JSON.parse(triggerJson) as unknown;
    if (parsed && typeof parsed === "object") {
      const metadata = (parsed as Record<string, unknown>)["metadata"];
      if (metadata && typeof metadata === "object") {
        const planId = (metadata as Record<string, unknown>)["plan_id"];
        if (typeof planId === "string" && planId.trim().length > 0) {
          return planId;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export class ExecutionEngine {
  private readonly db: SqlDb;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly logger?: Logger;

  constructor(opts: {
    db: SqlDb;
    clock?: ClockFn;
    redactionEngine?: RedactionEngine;
    logger?: Logger;
  }) {
    this.db = opts.db;
    this.clock = opts.clock ?? defaultClock;
    this.redactionEngine = opts.redactionEngine;
    this.logger = opts.logger;
  }

  private redactUnknown<T>(value: T): T {
    return this.redactionEngine
      ? (this.redactionEngine.redactUnknown(value).redacted as T)
      : value;
  }

  private redactText(text: string): string {
    return this.redactionEngine ? this.redactionEngine.redactText(text).redacted : text;
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    const jobId = randomUUID();
    const runId = randomUUID();

    const trigger = {
      kind: "session",
      key: input.key,
      lane: input.lane,
      metadata: {
        plan_id: input.planId,
        request_id: input.requestId,
      },
    };

    const triggerJson = JSON.stringify(trigger);
    const inputJson = JSON.stringify({
      plan_id: input.planId,
      request_id: input.requestId,
    });

    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        [jobId, input.key, input.lane, triggerJson, inputJson, runId],
      );

      await tx.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, 'queued', 1)`,
        [runId, jobId, input.key, input.lane],
      );

      for (let idx = 0; idx < input.steps.length; idx += 1) {
        const stepId = randomUUID();
        const action = input.steps[idx]!;
        await tx.run(
          `INSERT INTO execution_steps (
             step_id,
             run_id,
             step_index,
             status,
             action_json,
             idempotency_key,
             postcondition_json
           ) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
          [
            stepId,
            runId,
            idx,
            JSON.stringify(action),
            action.idempotency_key ?? null,
            action.postcondition ? JSON.stringify(action.postcondition) : null,
          ],
        );
      }
    });
    this.logger?.info("execution.enqueue", {
      request_id: input.requestId,
      plan_id: input.planId,
      job_id: jobId,
      run_id: runId,
      key: input.key,
      lane: input.lane,
      steps_count: input.steps.length,
    });
    return { jobId, runId };
  }

  /**
   * Resume a paused run using an opaque token.
   *
   * Returns the resumed run id on success, otherwise `undefined`.
   */
  async resumeRun(token: string): Promise<string | undefined> {
    const { nowIso } = this.clock();
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<ResumeTokenRow>(
        `SELECT token, run_id, expires_at, revoked_at
         FROM resume_tokens
         WHERE token = ?`,
        [token],
      );
      if (!row) return undefined;
      if (row.revoked_at) return undefined;

      if (row.expires_at) {
        const expiresAtMs =
          row.expires_at instanceof Date
            ? row.expires_at.getTime()
            : Date.parse(row.expires_at);
        if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          // Expired token; revoke so it can't be replayed.
          await tx.run(
            `UPDATE resume_tokens
             SET revoked_at = ?
             WHERE token = ? AND revoked_at IS NULL`,
            [nowIso, token],
          );
          return undefined;
        }
      }

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE token = ? AND revoked_at IS NULL`,
        [nowIso, token],
      );

      await tx.run(
        `UPDATE execution_runs
         SET status = 'queued', paused_reason = NULL, paused_detail = NULL
         WHERE run_id = ? AND status = 'paused'`,
        [row.run_id],
      );

      await tx.run(
        `UPDATE execution_steps
         SET status = 'queued'
         WHERE run_id = ? AND status = 'paused'`,
        [row.run_id],
      );

      return row.run_id;
    });
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();

    const candidates = await this.db.all<RunnableRunRow>(
      `SELECT
         r.run_id,
         r.job_id,
         r.key,
         r.lane,
         r.status,
         j.trigger_json
       FROM execution_runs r
       JOIN execution_jobs j ON j.job_id = r.job_id
       WHERE r.status IN ('running', 'queued')
         AND NOT EXISTS (
           SELECT 1 FROM execution_runs p
           WHERE p.key = r.key AND p.lane = r.lane AND p.status = 'paused'
         )
       ORDER BY
         CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
         r.created_at ASC
       LIMIT 10`,
    );

    for (const run of candidates) {
      const leaseOk = await this.tryAcquireLaneLease({
        key: run.key,
        lane: run.lane,
        owner: input.workerId,
        nowMs,
        ttlMs: 60_000,
      });
      if (!leaseOk) continue;

      try {
        const didWork = await this.tickWithLaneLease(run, input, { nowMs, nowIso });
        if (didWork) return true;
      } finally {
        // Lane leases are held across the whole run while it's active.
        // The tick function releases on completion/failure. On transient
        // errors we still keep the lease for a short TTL to reduce stampedes.
      }
    }

    return false;
  }

  private async tickWithLaneLease(
    run: RunnableRunRow,
    input: WorkerTickInput,
    clock: ExecutionClock,
  ): Promise<boolean> {
    const outcome = await this.db.transaction(async (tx) => {
      if (run.status === "queued") {
        await tx.run(
          `UPDATE execution_runs
           SET status = 'running', started_at = ?
           WHERE run_id = ? AND status = 'queued'`,
          [clock.nowIso, run.run_id],
        );
      }

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'running'
         WHERE job_id = ? AND status = 'queued'`,
        [run.job_id],
      );

      // Find next incomplete step.
      const next = await tx.get<StepRow>(
        `SELECT
           step_id,
           step_index,
           status,
           action_json,
           idempotency_key,
           postcondition_json,
           max_attempts,
           timeout_ms
         FROM execution_steps
         WHERE run_id = ? AND status IN ('queued', 'running', 'paused')
         ORDER BY step_index ASC
         LIMIT 1`,
        [run.run_id],
      );

      if (!next) {
        // Finalize run if all steps are terminal.
        const statuses = await tx.all<{ status: string }>(
          "SELECT status FROM execution_steps WHERE run_id = ?",
          [run.run_id],
        );
        const failed = statuses.some(
          (s) => s.status === "failed" || s.status === "cancelled",
        );

        await tx.run(
          `UPDATE execution_runs
           SET status = ?, finished_at = ?
           WHERE run_id = ? AND status != 'paused'`,
          [failed ? "failed" : "succeeded", clock.nowIso, run.run_id],
        );

        await tx.run(
          `UPDATE execution_jobs
           SET status = ?
           WHERE job_id = ?`,
          [failed ? "failed" : "completed", run.job_id],
        );

        await tx.run(
          `DELETE FROM lane_leases
           WHERE key = ? AND lane = ? AND lease_owner = ?`,
          [run.key, run.lane, input.workerId],
        );

        return { kind: "finalized" as const };
      }

      if (next.status === "paused") {
        return { kind: "noop" as const };
      }

      if (next.status === "running") {
        // Stale attempt takeover: if a prior worker crashed mid-step,
        // cancel the stale attempt and re-queue the step.
        const latestAttempt = await tx.get<{
          attempt_id: string;
          lease_expires_at_ms: number | null;
        }>(
          `SELECT attempt_id, lease_expires_at_ms
           FROM execution_attempts
           WHERE step_id = ? AND status = 'running'
           ORDER BY attempt DESC
           LIMIT 1`,
          [next.step_id],
        );

        const expiresAtMs = latestAttempt?.lease_expires_at_ms ?? 0;
        if (latestAttempt && expiresAtMs <= clock.nowMs) {
          await tx.run(
            `UPDATE execution_attempts
             SET status = 'cancelled', finished_at = ?, error = ?
             WHERE attempt_id = ? AND status = 'running'`,
            [clock.nowIso, "lease expired; takeover", latestAttempt.attempt_id],
          );

          await tx.run(
            `UPDATE execution_steps
             SET status = 'queued'
             WHERE step_id = ? AND status = 'running'`,
            [next.step_id],
          );
          return { kind: "recovered" as const };
        }

        return { kind: "noop" as const };
      }

      const attemptAgg = await tx.get<{ n: number }>(
        "SELECT COALESCE(MAX(attempt), 0) AS n FROM execution_attempts WHERE step_id = ?",
        [next.step_id],
      );
      const attemptNum = (attemptAgg?.n ?? 0) + 1;
      const attemptId = randomUUID();

      const leaseTtlMs = Math.max(30_000, next.timeout_ms + 10_000);

      if (next.idempotency_key) {
        const record = await tx.get<{ status: string; result_json: string | null }>(
          `SELECT status, result_json
           FROM idempotency_records
           WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
          [next.step_id, next.idempotency_key],
        );

        if (record?.status === "succeeded") {
          const updated = await tx.run(
            `UPDATE execution_steps
             SET status = 'succeeded'
             WHERE step_id = ? AND status = 'queued'`,
            [next.step_id],
          );
          if (updated.changes === 1) {
            await tx.run(
              `INSERT INTO execution_attempts (
                 attempt_id,
                 step_id,
                 attempt,
                 status,
                 started_at,
                 finished_at,
                 artifacts_json,
                 result_json,
                 error
               ) VALUES (?, ?, ?, 'succeeded', ?, ?, '[]', ?, NULL)`,
              [
                attemptId,
                next.step_id,
                attemptNum,
                clock.nowIso,
                clock.nowIso,
                record.result_json ?? null,
              ],
            );

            return { kind: "idempotent" as const };
          }
        }
      }

      const updated = await tx.run(
        `UPDATE execution_steps
         SET status = 'running'
         WHERE step_id = ? AND status = 'queued'`,
        [next.step_id],
      );

      if (updated.changes !== 1) {
        return { kind: "noop" as const };
      }

      await tx.run(
        `INSERT INTO execution_attempts (
           attempt_id,
           step_id,
           attempt,
           status,
           started_at,
           artifacts_json,
           lease_owner,
           lease_expires_at_ms
         ) VALUES (?, ?, ?, 'running', ?, '[]', ?, ?)`,
        [
          attemptId,
          next.step_id,
          attemptNum,
          clock.nowIso,
          input.workerId,
          clock.nowMs + leaseTtlMs,
        ],
      );

      await tx.run(
        `UPDATE lane_leases
         SET lease_expires_at_ms = ?
         WHERE key = ? AND lane = ? AND lease_owner = ?`,
        [clock.nowMs + leaseTtlMs, run.key, run.lane, input.workerId],
      );

      return {
        kind: "claimed" as const,
        runId: run.run_id,
        jobId: run.job_id,
        key: run.key,
        lane: run.lane,
        triggerJson: run.trigger_json,
        step: next,
        attempt: {
          attemptId,
          attemptNum,
        },
      };
    });

    if (outcome.kind === "noop") return false;
    if (outcome.kind === "recovered") return true;
    if (outcome.kind === "finalized") return true;
    if (outcome.kind === "idempotent") return true;

    const planId =
      parsePlanIdFromTriggerJson(outcome.triggerJson) ?? outcome.runId;

    const action = JSON.parse(outcome.step.action_json) as ActionPrimitiveT;
    const timeoutMs = Math.max(1, outcome.step.timeout_ms);

    return await this.executeAttempt({
      planId,
      stepIndex: outcome.step.step_index,
      action,
      postconditionJson: outcome.step.postcondition_json,
      maxAttempts: outcome.step.max_attempts,
      timeoutMs,
      runId: outcome.runId,
      jobId: outcome.jobId,
      key: outcome.key,
      lane: outcome.lane,
      stepId: outcome.step.step_id,
      attemptId: outcome.attempt.attemptId,
      attemptNum: outcome.attempt.attemptNum,
      workerId: input.workerId,
      executor: input.executor,
    });
  }

  private async executeAttempt(opts: {
    planId: string;
    stepIndex: number;
    action: ActionPrimitiveT;
    postconditionJson: string | null;
    maxAttempts: number;
    timeoutMs: number;
    runId: string;
    jobId: string;
    key: string;
    lane: string;
    stepId: string;
    attemptId: string;
    attemptNum: number;
    workerId: string;
    executor: StepExecutor;
  }): Promise<boolean> {
    const wallStartMs = Date.now();

    this.logger?.info("execution.attempt.start", {
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

    const result = await this.executeWithTimeout(
      opts.executor,
      opts.action,
      opts.planId,
      opts.stepIndex,
      opts.timeoutMs,
    );
    const wallDurationMs = Math.max(0, Date.now() - wallStartMs);

    const evidenceJson =
      result.evidence !== undefined
        ? JSON.stringify(this.redactUnknown(result.evidence))
        : null;
    const artifactsJson = JSON.stringify(this.redactUnknown(result.artifacts ?? []));
    const cost = this.redactUnknown({
      ...(result.cost ?? {}),
      duration_ms: result.cost?.duration_ms ?? wallDurationMs,
    });
    const costJson = JSON.stringify(cost);

    if (result.success) {
      // Postcondition evaluation (pause on missing evidence).
      let postconditionError: string | undefined;
      let postconditionReportJson: string | null = null;

      if (opts.postconditionJson) {
        try {
          const spec = JSON.parse(opts.postconditionJson) as unknown;
          const report = evaluatePostcondition(spec, result.evidence ?? {});
          postconditionReportJson = JSON.stringify(this.redactUnknown(report));
          if (!report.passed) {
            postconditionError = "postcondition failed";
          }
        } catch (err) {
          if (err instanceof PostconditionError) {
            if (err.kind === "missing_evidence") {
              // Pause the run for manual intervention.
              const detail = `postcondition missing evidence: ${err.message}`;
              await this.markAttemptSucceeded(
                opts,
                result,
                evidenceJson,
                null,
                artifactsJson,
                costJson,
              );
              await this.pauseRunAndStep(opts, "manual", detail);
              this.logger?.info("execution.attempt.paused", {
                job_id: opts.jobId,
                run_id: opts.runId,
                step_id: opts.stepId,
                attempt_id: opts.attemptId,
                reason: "manual",
              });
              return true;
            }
            postconditionError = `postcondition error: ${err.message}`;
          } else {
            postconditionError = "postcondition error";
          }
        }
      }

      if (postconditionError) {
        // Treat postcondition failure as a step failure (retryable).
        await this.markAttemptFailed(
          opts,
          postconditionError,
          evidenceJson,
          postconditionReportJson,
          artifactsJson,
          costJson,
        );
        this.logger?.info("execution.attempt.failed", {
          job_id: opts.jobId,
          run_id: opts.runId,
          step_id: opts.stepId,
          attempt_id: opts.attemptId,
          status: "failed",
          error: this.redactText(postconditionError),
        });
        return await this.maybeRetryOrFailStep(opts);
      }

      await this.markAttemptSucceeded(
        opts,
        result,
        evidenceJson,
        postconditionReportJson,
        artifactsJson,
        costJson,
      );
      this.logger?.info("execution.attempt.succeeded", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        status: "succeeded",
        duration_ms: wallDurationMs,
        cost,
      });
      await this.db.run(
        `UPDATE execution_steps
         SET status = 'succeeded'
         WHERE step_id = ?`,
        [opts.stepId],
      );

      const idempotencyKey = opts.action.idempotency_key?.trim();
      if (idempotencyKey) {
        const resultJson =
          result.result !== undefined
            ? JSON.stringify(this.redactUnknown(result.result))
            : null;
        await this.db.run(
          `INSERT INTO idempotency_records (
             scope_key,
             kind,
             idempotency_key,
             status,
             result_json,
             error,
             updated_at
           ) VALUES (?, 'step', ?, 'succeeded', ?, NULL, ?)
           ON CONFLICT (scope_key, kind, idempotency_key) DO UPDATE SET
             status = excluded.status,
             result_json = excluded.result_json,
             error = NULL,
             updated_at = excluded.updated_at`,
          [opts.stepId, idempotencyKey, resultJson, this.clock().nowIso],
        );
      }
      return true;
    }

    const error = result.error ?? "unknown error";
    const redactedError = this.redactText(error);
    const timedOut = error.toLowerCase().includes("timed out");
    const status = timedOut ? "timed_out" : "failed";

    await this.db.run(
      `UPDATE execution_attempts
       SET status = ?, finished_at = ?, result_json = NULL, error = ?, metadata_json = ?, artifacts_json = ?, cost_json = ?
       WHERE attempt_id = ?`,
      [
        status,
        this.clock().nowIso,
        redactedError,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      ],
    );

    this.logger?.info("execution.attempt.failed", {
      job_id: opts.jobId,
      run_id: opts.runId,
      step_id: opts.stepId,
      attempt_id: opts.attemptId,
      status,
      error: redactedError,
      duration_ms: wallDurationMs,
      cost,
    });

    return await this.maybeRetryOrFailStep(opts);
  }

  private async markAttemptSucceeded(
    opts: { attemptId: string },
    result: StepResult,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const resultJson =
      result.result !== undefined
        ? JSON.stringify(this.redactUnknown(result.result))
        : null;

    await this.db.run(
      `UPDATE execution_attempts
       SET status = 'succeeded',
           finished_at = ?,
           result_json = ?,
           error = NULL,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE attempt_id = ?`,
      [
        this.clock().nowIso,
        resultJson,
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      ],
    );
  }

  private async markAttemptFailed(
    opts: { attemptId: string },
    error: string,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    await this.db.run(
      `UPDATE execution_attempts
       SET status = 'failed',
           finished_at = ?,
           result_json = NULL,
           error = ?,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE attempt_id = ?`,
      [
        this.clock().nowIso,
        this.redactText(error),
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      ],
    );
  }

  private async maybeRetryOrFailStep(opts: {
    attemptNum: number;
    maxAttempts: number;
    stepId: string;
    runId: string;
    jobId: string;
    key: string;
    lane: string;
    workerId: string;
  }): Promise<boolean> {
    if (opts.attemptNum < Math.max(1, opts.maxAttempts)) {
      await this.db.run(
        `UPDATE execution_steps
         SET status = 'queued'
         WHERE step_id = ?`,
        [opts.stepId],
      );
      return true;
    }

    await this.db.run(
      `UPDATE execution_steps
       SET status = 'failed'
       WHERE step_id = ?`,
      [opts.stepId],
    );

    await this.db.run(
      `UPDATE execution_steps
       SET status = 'cancelled'
       WHERE run_id = ? AND status = 'queued'`,
      [opts.runId],
    );

    await this.db.run(
      `UPDATE execution_runs
       SET status = 'failed', finished_at = ?
       WHERE run_id = ?`,
      [this.clock().nowIso, opts.runId],
    );

    await this.db.run(
      `UPDATE execution_jobs
       SET status = 'failed'
       WHERE job_id = ?`,
      [opts.jobId],
    );

    await this.releaseLaneLease({
      key: opts.key,
      lane: opts.lane,
      owner: opts.workerId,
    });

    return true;
  }

  private async pauseRunAndStep(
    opts: {
      runId: string;
      stepId: string;
      jobId: string;
      key: string;
      lane: string;
      workerId: string;
    },
    reason: string,
    detail: string,
  ): Promise<void> {
    await this.db.run(
      `UPDATE execution_runs
       SET status = 'paused', paused_reason = ?, paused_detail = ?
       WHERE run_id = ?`,
      [reason, this.redactText(detail), opts.runId],
    );

    await this.db.run(
      `UPDATE execution_steps
       SET status = 'paused'
       WHERE step_id = ?`,
      [opts.stepId],
    );

    const token = `resume-${randomUUID()}`;
    await this.db.run(
      `INSERT INTO resume_tokens (token, run_id, created_at)
       VALUES (?, ?, ?)`,
      [token, opts.runId, this.clock().nowIso],
    );

    // Keep lane lease held by active worker; it will expire quickly and block
    // only briefly. New work selection also blocks on paused runs.
    await this.releaseLaneLease({
      key: opts.key,
      lane: opts.lane,
      owner: opts.workerId,
    });
  }

  private async executeWithTimeout(
    executor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
  ): Promise<StepResult> {
    try {
      return await executor.execute(action, planId, stepIndex, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  private async tryAcquireLaneLease(opts: {
    key: string;
    lane: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<boolean> {
    const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<{
        lease_owner: string;
        lease_expires_at_ms: number;
      }>(
        `SELECT lease_owner, lease_expires_at_ms
         FROM lane_leases
         WHERE key = ? AND lane = ?`,
        [opts.key, opts.lane],
      );

      if (!existing) {
        await tx.run(
          `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
           VALUES (?, ?, ?, ?)`,
          [opts.key, opts.lane, opts.owner, expiresAt],
        );
        return true;
      }

      const expired = existing.lease_expires_at_ms <= opts.nowMs;
      const sameOwner = existing.lease_owner === opts.owner;

      if (!expired && !sameOwner) {
        return false;
      }

      await tx.run(
        `UPDATE lane_leases
         SET lease_owner = ?, lease_expires_at_ms = ?
         WHERE key = ? AND lane = ?`,
        [opts.owner, expiresAt, opts.key, opts.lane],
      );
      return true;
    });
  }

  private async releaseLaneLease(opts: {
    key: string;
    lane: string;
    owner: string;
  }): Promise<void> {
    await this.db.run(
      `DELETE FROM lane_leases
       WHERE key = ? AND lane = ? AND lease_owner = ?`,
      [opts.key, opts.lane, opts.owner],
    );
  }
}
