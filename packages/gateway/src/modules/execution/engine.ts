import type Database from "better-sqlite3";
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

export interface StepResult {
  success: boolean;
  result?: unknown;
  error?: string;
  evidence?: EvaluationContext;
  artifacts?: ArtifactRefT[];
  cost?: AttemptCostT;
}

export interface StepExecutor {
  execute(action: ActionPrimitiveT, planId: string, stepIndex: number): Promise<StepResult>;
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
  expires_at: string | null;
  revoked_at: string | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExecutionEngine {
  private readonly db: Database.Database;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly logger?: Logger;

  constructor(opts: {
    db: Database.Database;
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

  enqueuePlan(input: EnqueuePlanInput): EnqueuePlanResult {
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

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
           VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        )
        .run(jobId, input.key, input.lane, triggerJson, inputJson, runId);

      this.db
        .prepare(
          `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
           VALUES (?, ?, ?, ?, 'queued', 1)`,
        )
        .run(runId, jobId, input.key, input.lane);

      const insertStep = this.db.prepare(
        `INSERT INTO execution_steps (
           step_id,
           run_id,
           step_index,
           status,
           action_json,
           idempotency_key,
           postcondition_json
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      );

      for (let idx = 0; idx < input.steps.length; idx += 1) {
        const stepId = randomUUID();
        const action = input.steps[idx]!;
        insertStep.run(
          stepId,
          runId,
          idx,
          JSON.stringify(action),
          action.idempotency_key ?? null,
          action.postcondition ? JSON.stringify(action.postcondition) : null,
        );
      }
    });

    txn();
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
  resumeRun(token: string): string | undefined {
    const { nowIso } = this.clock();
    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT token, run_id, expires_at, revoked_at
           FROM resume_tokens
           WHERE token = ?`,
        )
        .get(token) as ResumeTokenRow | undefined;
      if (!row) return undefined;
      if (row.revoked_at) return undefined;

      if (row.expires_at) {
        const expiresAtMs = Date.parse(row.expires_at);
        if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          // Expired token; revoke so it can't be replayed.
          this.db
            .prepare(
              `UPDATE resume_tokens
               SET revoked_at = ?
               WHERE token = ? AND revoked_at IS NULL`,
            )
            .run(nowIso, token);
          return undefined;
        }
      }

      this.db
        .prepare(
          `UPDATE resume_tokens
           SET revoked_at = ?
           WHERE token = ? AND revoked_at IS NULL`,
        )
        .run(nowIso, token);

      this.db
        .prepare(
          `UPDATE execution_runs
           SET status = 'queued', paused_reason = NULL, paused_detail = NULL
           WHERE run_id = ? AND status = 'paused'`,
        )
        .run(row.run_id);

      this.db
        .prepare(
          `UPDATE execution_steps
           SET status = 'queued'
           WHERE run_id = ? AND status = 'paused'`,
        )
        .run(row.run_id);

      return row.run_id;
    });

    return txn();
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();

    const candidates = this.db
      .prepare(
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
      )
      .all() as RunnableRunRow[];

    for (const run of candidates) {
      const leaseOk = this.tryAcquireLaneLease({
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

  private tickWithLaneLease(
    run: RunnableRunRow,
    input: WorkerTickInput,
    clock: ExecutionClock,
  ): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Ensure run is in running state.
      if (run.status === "queued") {
        this.db
          .prepare(
            `UPDATE execution_runs
             SET status = 'running', started_at = ?
             WHERE run_id = ? AND status = 'queued'`,
          )
          .run(clock.nowIso, run.run_id);
      }

      this.db
        .prepare(
          `UPDATE execution_jobs
           SET status = 'running'
           WHERE job_id = ? AND status = 'queued'`,
        )
        .run(run.job_id);

      // Find next queued step.
      const next = this.db
        .prepare(
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
           WHERE run_id = ? AND status = 'queued'
           ORDER BY step_index ASC
           LIMIT 1`,
        )
        .get(run.run_id) as StepRow | undefined;

      if (!next) {
        // Stale attempt takeover: if a prior worker crashed mid-step,
        // cancel the stale attempt and re-queue the step.
        const runningSteps = this.db
          .prepare(
            `SELECT step_id
             FROM execution_steps
             WHERE run_id = ? AND status = 'running'
             ORDER BY step_index ASC
             LIMIT 5`,
          )
          .all(run.run_id) as Array<{ step_id: string }>;

        let didRecover = false;
        for (const step of runningSteps) {
          const latestAttempt = this.db
            .prepare(
              `SELECT attempt_id, lease_expires_at_ms
               FROM execution_attempts
               WHERE step_id = ? AND status = 'running'
               ORDER BY attempt DESC
               LIMIT 1`,
            )
            .get(step.step_id) as
            | { attempt_id: string; lease_expires_at_ms: number | null }
            | undefined;

          const expiresAtMs = latestAttempt?.lease_expires_at_ms ?? 0;
          if (latestAttempt && expiresAtMs <= clock.nowMs) {
            this.db
              .prepare(
                `UPDATE execution_attempts
                 SET status = 'cancelled', finished_at = ?, error = ?
                 WHERE attempt_id = ? AND status = 'running'`,
              )
              .run(clock.nowIso, "lease expired; takeover", latestAttempt.attempt_id);

            this.db
              .prepare(
                `UPDATE execution_steps
                 SET status = 'queued'
                 WHERE step_id = ? AND status = 'running'`,
              )
              .run(step.step_id);
            didRecover = true;
          }
        }

        // Finalize run if all steps are terminal.
        const statuses = this.db
          .prepare("SELECT status FROM execution_steps WHERE run_id = ?")
          .all(run.run_id) as Array<{ status: string }>;

        const hasQueuedOrRunning = statuses.some(
          (s) => s.status === "queued" || s.status === "running",
        );
        const hasPaused = statuses.some((s) => s.status === "paused");
        if (hasQueuedOrRunning || hasPaused) {
          // Nothing we can do in this tick.
          return didRecover ? { kind: "recovered" as const } : { kind: "noop" as const };
        }

        const failed = statuses.some(
          (s) => s.status === "failed" || s.status === "cancelled",
        );

        this.db
          .prepare(
            `UPDATE execution_runs
             SET status = ?, finished_at = ?
             WHERE run_id = ? AND status != 'paused'`,
          )
          .run(failed ? "failed" : "succeeded", clock.nowIso, run.run_id);

        this.db
          .prepare(
            `UPDATE execution_jobs
             SET status = ?
             WHERE job_id = ?`,
          )
          .run(failed ? "failed" : "completed", run.job_id);

        this.releaseLaneLease({
          key: run.key,
          lane: run.lane,
          owner: input.workerId,
        });

        return { kind: "finalized" as const };
      }

      const attemptAgg = this.db
        .prepare(
          "SELECT COALESCE(MAX(attempt), 0) AS n FROM execution_attempts WHERE step_id = ?",
        )
        .get(next.step_id) as { n: number };

      const attemptNum = attemptAgg.n + 1;
      const attemptId = randomUUID();

      const leaseTtlMs = Math.max(30_000, next.timeout_ms + 10_000);

      // Idempotency short-circuit: if a prior attempt already produced a
      // succeeded outcome for this (step_id, idempotency_key), skip execution
      // and record a synthetic succeeded attempt for auditability.
      if (next.idempotency_key) {
        const record = this.db
          .prepare(
            `SELECT status, result_json
             FROM idempotency_records
             WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
          )
          .get(next.step_id, next.idempotency_key) as
          | { status: string; result_json: string | null }
          | undefined;

        if (record?.status === "succeeded") {
          const updated = this.db
            .prepare(
              `UPDATE execution_steps
               SET status = 'succeeded'
               WHERE step_id = ? AND status = 'queued'`,
            )
            .run(next.step_id);
          if (updated.changes === 1) {
            this.db
              .prepare(
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
              )
              .run(
                attemptId,
                next.step_id,
                attemptNum,
                clock.nowIso,
                clock.nowIso,
                record.result_json ?? null,
              );

            return { kind: "idempotent" as const };
          }
        }
      }

      const updated = this.db
        .prepare(
          `UPDATE execution_steps
           SET status = 'running'
           WHERE step_id = ? AND status = 'queued'`,
        )
        .run(next.step_id);

      if (updated.changes !== 1) {
        return { kind: "noop" as const };
      }

      this.db
        .prepare(
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
        )
        .run(
          attemptId,
          next.step_id,
          attemptNum,
          clock.nowIso,
          input.workerId,
          clock.nowMs + leaseTtlMs,
        );

      // Extend the lane lease to cover the expected attempt runtime.
      this.db
        .prepare(
          `UPDATE lane_leases
           SET lease_expires_at_ms = ?
           WHERE key = ? AND lane = ? AND lease_owner = ?`,
        )
        .run(clock.nowMs + leaseTtlMs, run.key, run.lane, input.workerId);

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

    const outcome = txn();

    if (outcome.kind === "noop") return Promise.resolve(false);
    if (outcome.kind === "recovered") return Promise.resolve(true);
    if (outcome.kind === "finalized") return Promise.resolve(true);
    if (outcome.kind === "idempotent") return Promise.resolve(true);

    const planId =
      parsePlanIdFromTriggerJson(outcome.triggerJson) ?? outcome.runId;

    const action = JSON.parse(outcome.step.action_json) as ActionPrimitiveT;
    const timeoutMs = Math.max(1, outcome.step.timeout_ms);

    return this.executeAttempt({
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
              this.markAttemptSucceeded(opts, result, evidenceJson, null, artifactsJson, costJson);
              this.pauseRunAndStep(opts, "manual", detail);
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
        this.markAttemptFailed(
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
        return this.maybeRetryOrFailStep(opts);
      }

      this.markAttemptSucceeded(
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
      this.db
        .prepare(
          `UPDATE execution_steps
           SET status = 'succeeded'
           WHERE step_id = ?`,
        )
        .run(opts.stepId);

      const idempotencyKey = opts.action.idempotency_key?.trim();
      if (idempotencyKey) {
        const resultJson =
          result.result !== undefined
            ? JSON.stringify(this.redactUnknown(result.result))
            : null;
        this.db
          .prepare(
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
          )
          .run(opts.stepId, idempotencyKey, resultJson, this.clock().nowIso);
      }
      return true;
    }

    const error = result.error ?? "unknown error";
    const redactedError = this.redactText(error);
    const timedOut = error.toLowerCase().includes("timed out");
    const status = timedOut ? "timed_out" : "failed";

    this.db
      .prepare(
        `UPDATE execution_attempts
         SET status = ?, finished_at = ?, result_json = NULL, error = ?, metadata_json = ?, artifacts_json = ?, cost_json = ?
         WHERE attempt_id = ?`,
      )
      .run(
        status,
        this.clock().nowIso,
        redactedError,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
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

    return this.maybeRetryOrFailStep(opts);
  }

  private markAttemptSucceeded(
    opts: { attemptId: string },
    result: StepResult,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): void {
    const resultJson =
      result.result !== undefined
        ? JSON.stringify(this.redactUnknown(result.result))
        : null;

    this.db
      .prepare(
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
      )
      .run(
        this.clock().nowIso,
        resultJson,
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      );
  }

  private markAttemptFailed(
    opts: { attemptId: string },
    error: string,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): void {
    this.db
      .prepare(
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
      )
      .run(
        this.clock().nowIso,
        this.redactText(error),
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      );
  }

  private maybeRetryOrFailStep(opts: {
    attemptNum: number;
    maxAttempts: number;
    stepId: string;
    runId: string;
    jobId: string;
    key: string;
    lane: string;
    workerId: string;
  }): boolean {
    if (opts.attemptNum < Math.max(1, opts.maxAttempts)) {
      this.db
        .prepare(
          `UPDATE execution_steps
           SET status = 'queued'
           WHERE step_id = ?`,
        )
        .run(opts.stepId);
      return true;
    }

    this.db
      .prepare(
        `UPDATE execution_steps
         SET status = 'failed'
         WHERE step_id = ?`,
      )
      .run(opts.stepId);

    this.db
      .prepare(
        `UPDATE execution_runs
         SET status = 'failed', finished_at = ?
         WHERE run_id = ?`,
      )
      .run(this.clock().nowIso, opts.runId);

    this.db
      .prepare(
        `UPDATE execution_jobs
         SET status = 'failed'
         WHERE job_id = ?`,
      )
      .run(opts.jobId);

    this.releaseLaneLease({
      key: opts.key,
      lane: opts.lane,
      owner: opts.workerId,
    });

    return true;
  }

  private pauseRunAndStep(
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
  ): void {
    this.db
      .prepare(
        `UPDATE execution_runs
         SET status = 'paused', paused_reason = ?, paused_detail = ?
         WHERE run_id = ?`,
      )
      .run(reason, this.redactText(detail), opts.runId);

    this.db
      .prepare(
        `UPDATE execution_steps
         SET status = 'paused'
         WHERE step_id = ?`,
      )
      .run(opts.stepId);

    const token = `resume-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO resume_tokens (token, run_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(token, opts.runId, this.clock().nowIso);

    // Keep lane lease held by active worker; it will expire quickly and block
    // only briefly. New work selection also blocks on paused runs.
    this.releaseLaneLease({
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
      const result = await Promise.race([
        executor.execute(action, planId, stepIndex),
        sleep(timeoutMs).then((): StepResult => ({
          success: false,
          error: `job timed out after ${timeoutMs}ms`,
        })),
      ]);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  private tryAcquireLaneLease(opts: {
    key: string;
    lane: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  }): boolean {
    const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
    const txn = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT lease_owner, lease_expires_at_ms
           FROM lane_leases
           WHERE key = ? AND lane = ?`,
        )
        .get(opts.key, opts.lane) as
        | { lease_owner: string; lease_expires_at_ms: number }
        | undefined;

      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
             VALUES (?, ?, ?, ?)`,
          )
          .run(opts.key, opts.lane, opts.owner, expiresAt);
        return true;
      }

      const expired = existing.lease_expires_at_ms <= opts.nowMs;
      const sameOwner = existing.lease_owner === opts.owner;

      if (!expired && !sameOwner) {
        return false;
      }

      this.db
        .prepare(
          `UPDATE lane_leases
           SET lease_owner = ?, lease_expires_at_ms = ?
           WHERE key = ? AND lane = ?`,
        )
        .run(opts.owner, expiresAt, opts.key, opts.lane);
      return true;
    });

    return txn();
  }

  private releaseLaneLease(opts: { key: string; lane: string; owner: string }): void {
    this.db
      .prepare(
        `DELETE FROM lane_leases
         WHERE key = ? AND lane = ? AND lease_owner = ?`,
      )
      .run(opts.key, opts.lane, opts.owner);
  }
}
