import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  AttemptCost as AttemptCostT,
  ProvenanceTag as ProvenanceTagT,
} from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import { ProvenanceTag, TyrumKey, parseTyrumKey } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import { evaluateAction } from "../policy-bundle/evaluate.js";
import { PolicyBundleService } from "../policy-bundle/service.js";
import { ApprovalDal } from "../approval/dal.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { ArtifactDal } from "../artifact/dal.js";

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
  playbookId?: string;
  provenanceSources?: ProvenanceTagT[];
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
  policy_snapshot_id: string | null;
  policy_snapshot_hash: string | null;
  trigger_json: string;
  workspace_id: string;
}

interface StepRow {
  step_id: string;
  step_index: number;
  status: string;
  action_json: string;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: number | null;
  max_attempts: number;
  timeout_ms: number;
}

const NOOP_APPROVAL_NOTIFIER: ApprovalNotifier = {
  notify(_approval) {
    // no-op
  },
};

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

function parsePolicyContextFromTriggerJson(triggerJson: string): {
  agentId?: string;
  playbookId?: string;
  provenanceSources?: ProvenanceTagT[];
} {
  try {
    const parsed = JSON.parse(triggerJson) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const metadata = (parsed as Record<string, unknown>)["metadata"];
    if (!metadata || typeof metadata !== "object") return {};

    const record = metadata as Record<string, unknown>;
    const agentId = typeof record["agent_id"] === "string" ? record["agent_id"] : undefined;
    const playbookId = typeof record["playbook_id"] === "string" ? record["playbook_id"] : undefined;
    const rawSources = record["provenance_sources"];
    const sources = Array.isArray(rawSources) ? rawSources : undefined;
    const parsedSources = sources
      ? sources
          .map((s) => (typeof s === "string" ? s : undefined))
          .filter((s): s is ProvenanceTagT => (s ? ProvenanceTag.safeParse(s).success : false))
      : undefined;

    return {
      agentId,
      playbookId,
      provenanceSources: parsedSources && parsedSources.length > 0 ? parsedSources : undefined,
    };
  } catch {
    return {};
  }
}

function tryParseAgentIdFromKey(key: string): string | undefined {
  const parsed = TyrumKey.safeParse(key);
  if (!parsed.success) return undefined;
  try {
    const res = parseTyrumKey(parsed.data);
    return res.kind === "agent" ? res.agent_id : undefined;
  } catch {
    return undefined;
  }
}

export class ExecutionEngine {
  private readonly db: SqlDb;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly logger?: Logger;
  private readonly policyBundleService: PolicyBundleService;
  private readonly approvalNotifier: ApprovalNotifier;
  private readonly artifactDal: ArtifactDal;

  constructor(opts: {
    db: SqlDb;
    clock?: ClockFn;
    redactionEngine?: RedactionEngine;
    logger?: Logger;
    policyBundleService?: PolicyBundleService;
    approvalNotifier?: ApprovalNotifier;
    artifactDal?: ArtifactDal;
  }) {
    this.db = opts.db;
    this.clock = opts.clock ?? defaultClock;
    this.redactionEngine = opts.redactionEngine;
    this.logger = opts.logger;
    this.policyBundleService =
      opts.policyBundleService ?? new PolicyBundleService(opts.db, { logger: opts.logger });
    this.approvalNotifier = opts.approvalNotifier ?? NOOP_APPROVAL_NOTIFIER;
    this.artifactDal = opts.artifactDal ?? new ArtifactDal(opts.db);
  }

  private redactUnknown<T>(value: T): T {
    return this.redactionEngine
      ? (this.redactionEngine.redactUnknown(value).redacted as T)
      : value;
  }

  private redactText(text: string): string {
    return this.redactionEngine ? this.redactionEngine.redactText(text).redacted : text;
  }

  private async persistAttemptArtifactsMetadata(input: {
    key: string;
    workspaceId: string;
    runId: string;
    stepId: string;
    attemptId: string;
    planId: string;
    artifacts: readonly ArtifactRefT[] | undefined;
  }): Promise<void> {
    if (!input.artifacts || input.artifacts.length === 0) return;
    const agentId = tryParseAgentIdFromKey(input.key) ?? "default";

    try {
      for (const ref of input.artifacts) {
        await this.artifactDal.upsertMetadata({
          ref,
          agentId,
          workspaceId: input.workspaceId,
          runId: input.runId,
          stepId: input.stepId,
          attemptId: input.attemptId,
          createdBy: input.planId,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error("artifact.metadata_persist_failed", {
        error: message,
        run_id: input.runId,
        step_id: input.stepId,
        attempt_id: input.attemptId,
      });
    }
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    const existing = await this.db.get<{ job_id: string; latest_run_id: string | null }>(
      "SELECT job_id, latest_run_id FROM execution_jobs WHERE request_id = ?",
      [input.requestId],
    );
    if (existing?.latest_run_id) {
      this.logger?.info("execution.enqueue.idempotent", {
        request_id: input.requestId,
        plan_id: input.planId,
        job_id: existing.job_id,
        run_id: existing.latest_run_id,
        key: input.key,
        lane: input.lane,
      });
      return { jobId: existing.job_id, runId: existing.latest_run_id };
    }

    const jobId = randomUUID();
    const runId = randomUUID();
    const agentId = tryParseAgentIdFromKey(input.key);
    const snapshot = await this.policyBundleService.getOrCreateSnapshot({
      agentId,
      playbookId: input.playbookId,
      createdBy: input.planId,
    });

    const trigger = {
      kind: "session",
      key: input.key,
      lane: input.lane,
      metadata: {
        plan_id: input.planId,
        request_id: input.requestId,
        agent_id: agentId ?? null,
        playbook_id: input.playbookId ?? null,
        provenance_sources: input.provenanceSources ?? null,
      },
    };

    const triggerJson = JSON.stringify(trigger);
    const inputJson = JSON.stringify({
      plan_id: input.planId,
      request_id: input.requestId,
    });

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id, request_id)
           VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
          [jobId, input.key, input.lane, triggerJson, inputJson, runId, input.requestId],
        );

        await tx.run(
          `INSERT INTO execution_runs (
             run_id,
             job_id,
             key,
             lane,
             status,
             attempt,
             policy_snapshot_id,
             policy_snapshot_hash
           )
           VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)`,
          [runId, jobId, input.key, input.lane, snapshot.policySnapshotId, snapshot.contentHash],
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
    } catch (err) {
      const current = await this.db.get<{ job_id: string; latest_run_id: string | null }>(
        "SELECT job_id, latest_run_id FROM execution_jobs WHERE request_id = ?",
        [input.requestId],
      );
      if (current?.latest_run_id) {
        this.logger?.info("execution.enqueue.idempotent", {
          request_id: input.requestId,
          plan_id: input.planId,
          job_id: current.job_id,
          run_id: current.latest_run_id,
          key: input.key,
          lane: input.lane,
        });
        return { jobId: current.job_id, runId: current.latest_run_id };
      }
      throw err;
    }
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

      const pausedStep = await tx.get<{ approval_id: number | null }>(
        `SELECT approval_id
         FROM execution_steps
         WHERE run_id = ? AND status = 'paused'
         ORDER BY step_index ASC
         LIMIT 1`,
        [row.run_id],
      );

      if (pausedStep?.approval_id) {
        const approval = await tx.get<{ status: string }>(
          "SELECT status FROM approvals WHERE id = ?",
          [pausedStep.approval_id],
        );
        if (approval?.status !== "approved") {
          // Approval-gated pause: do not revoke the token so it can be used
          // after the approval is resolved.
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

  /**
   * Cancel a paused run using an opaque resume token.
   *
   * Returns the cancelled run id on success, otherwise `undefined`.
   *
   * Note: cancellation is currently supported for paused runs only (to avoid
   * racing in-flight attempt execution without cooperative cancellation).
   */
  async cancelRunByResumeToken(token: string, reason?: string): Promise<string | undefined> {
    const { nowIso } = this.clock();
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<ResumeTokenRow>(
        `SELECT token, run_id, expires_at, revoked_at
         FROM resume_tokens
         WHERE token = ?`,
        [token],
      );
      if (!row) return undefined;

      if (row.expires_at) {
        const expiresAtMs =
          row.expires_at instanceof Date
            ? row.expires_at.getTime()
            : Date.parse(row.expires_at);
        if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          await tx.run(
            `UPDATE resume_tokens
             SET revoked_at = ?
             WHERE token = ? AND revoked_at IS NULL`,
            [nowIso, token],
          );
          return undefined;
        }
      }

      const run = await tx.get<{ run_id: string; job_id: string; status: string }>(
        `SELECT run_id, job_id, status
         FROM execution_runs
         WHERE run_id = ?`,
        [row.run_id],
      );
      if (!run) return undefined;

      if (run.status === "cancelled") {
        await tx.run(
          `UPDATE resume_tokens
           SET revoked_at = ?
           WHERE run_id = ? AND revoked_at IS NULL`,
          [nowIso, run.run_id],
        );
        return run.run_id;
      }

      if (run.status !== "paused") {
        return undefined;
      }

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE run_id = ? AND revoked_at IS NULL`,
        [nowIso, run.run_id],
      );

      await tx.run(
        `UPDATE execution_steps
         SET status = 'cancelled'
         WHERE run_id = ? AND status IN ('queued', 'paused')`,
        [run.run_id],
      );

      await tx.run(
        `UPDATE execution_runs
         SET status = 'cancelled', finished_at = ?, paused_reason = NULL, paused_detail = NULL
         WHERE run_id = ? AND status = 'paused'`,
        [nowIso, run.run_id],
      );

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'cancelled'
         WHERE job_id = ? AND status IN ('queued', 'running')`,
        [run.job_id],
      );

      if (reason && reason.trim().length > 0) {
        this.logger?.info("execution.cancelled", {
          run_id: run.run_id,
          job_id: run.job_id,
          reason: this.redactText(reason),
        });
      } else {
        this.logger?.info("execution.cancelled", { run_id: run.run_id, job_id: run.job_id });
      }

      return run.run_id;
    });
  }

  /**
   * Cancel a run by id.
   *
   * Returns the cancelled run id on success, otherwise `undefined`.
   */
  async cancelRun(runId: string, reason?: string): Promise<string | undefined> {
    const { nowIso } = this.clock();
    return await this.db.transaction(async (tx) => {
      const run = await tx.get<{ run_id: string; job_id: string; status: string }>(
        `SELECT run_id, job_id, status
         FROM execution_runs
         WHERE run_id = ?`,
        [runId],
      );
      if (!run) return undefined;

      if (run.status === "cancelled") return run.run_id;

      if (run.status === "running") {
        // Avoid racing in-flight attempts without cooperative cancellation.
        return undefined;
      }

      if (run.status !== "paused" && run.status !== "queued") {
        return undefined;
      }

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE run_id = ? AND revoked_at IS NULL`,
        [nowIso, run.run_id],
      );

      await tx.run(
        `UPDATE execution_steps
         SET status = 'cancelled'
         WHERE run_id = ? AND status IN ('queued', 'paused')`,
        [run.run_id],
      );

      await tx.run(
        `UPDATE execution_runs
         SET status = 'cancelled', finished_at = ?, paused_reason = NULL, paused_detail = NULL
         WHERE run_id = ? AND status IN ('paused', 'queued')`,
        [nowIso, run.run_id],
      );

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'cancelled'
         WHERE job_id = ? AND status IN ('queued', 'running')`,
        [run.job_id],
      );

      if (reason && reason.trim().length > 0) {
        this.logger?.info("execution.cancelled", {
          run_id: run.run_id,
          job_id: run.job_id,
          reason: this.redactText(reason),
        });
      } else {
        this.logger?.info("execution.cancelled", { run_id: run.run_id, job_id: run.job_id });
      }

      return run.run_id;
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
         r.policy_snapshot_id,
         r.policy_snapshot_hash,
         j.trigger_json,
         j.workspace_id
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

      const workspaceOk = await this.tryAcquireWorkspaceLease({
        workspaceId: run.workspace_id,
        owner: input.workerId,
        nowMs,
        ttlMs: 5_000,
      });
      if (!workspaceOk) {
        await this.releaseLaneLease({
          key: run.key,
          lane: run.lane,
          owner: input.workerId,
        });
        continue;
      }

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
    const planId =
      parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
    const policyCtx = parsePolicyContextFromTriggerJson(run.trigger_json);
    const provenance = policyCtx.provenanceSources
      ? { sources: policyCtx.provenanceSources }
      : undefined;

    let policy = undefined as Awaited<ReturnType<PolicyBundleService["getSnapshotById"]>> | undefined;
    let policySnapshotId = run.policy_snapshot_id;
    let policySnapshotHash = run.policy_snapshot_hash;

    if (!policySnapshotId || !policySnapshotHash) {
      const snap = await this.policyBundleService.getOrCreateSnapshot({
        agentId: policyCtx.agentId,
        playbookId: policyCtx.playbookId,
        createdBy: planId,
      });
      policy = snap.policy;
      policySnapshotId = snap.policySnapshotId;
      policySnapshotHash = snap.contentHash;

      await this.db.run(
        `UPDATE execution_runs
         SET policy_snapshot_id = ?, policy_snapshot_hash = ?
         WHERE run_id = ? AND (policy_snapshot_id IS NULL OR policy_snapshot_hash IS NULL)`,
        [policySnapshotId, policySnapshotHash, run.run_id],
      );
    } else {
      policy = await this.policyBundleService.getSnapshotById(policySnapshotId);
    }

    if (!policySnapshotId || !policySnapshotHash || !policy) {
      this.logger?.error("execution.policy_snapshot_missing", {
        run_id: run.run_id,
        job_id: run.job_id,
        plan_id: planId,
        policy_snapshot_id: policySnapshotId ?? null,
        policy_snapshot_hash: policySnapshotHash ?? null,
      });

      const nextStep = await this.db.get<Pick<StepRow, "step_id">>(
        `SELECT step_id
         FROM execution_steps
         WHERE run_id = ? AND status IN ('queued', 'running', 'paused')
         ORDER BY step_index ASC
         LIMIT 1`,
        [run.run_id],
      );

      if (nextStep?.step_id) {
        await this.pauseRunAndStep(
          {
            runId: run.run_id,
            stepId: nextStep.step_id,
            jobId: run.job_id,
            workspaceId: run.workspace_id,
            key: run.key,
            lane: run.lane,
            workerId: input.workerId,
          },
          "internal",
          "policy snapshot missing; manual intervention required",
        );
      } else {
        await this.db.run(
          `UPDATE execution_runs
           SET status = 'failed', finished_at = ?
           WHERE run_id = ?`,
          [clock.nowIso, run.run_id],
        );
        await this.db.run(
          `UPDATE execution_jobs
           SET status = 'failed'
           WHERE job_id = ?`,
          [run.job_id],
        );
        await this.releaseLaneLease({
          key: run.key,
          lane: run.lane,
          owner: input.workerId,
        });
        await this.releaseWorkspaceLease({
          workspaceId: run.workspace_id,
          owner: input.workerId,
        });
      }

      return true;
    }

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
	           approval_id,
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

        await tx.run(
          `DELETE FROM workspace_leases
           WHERE workspace_id = ? AND lease_owner = ?`,
          [run.workspace_id, input.workerId],
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

	      let action: ActionPrimitiveT;
	      try {
	        action = JSON.parse(next.action_json) as ActionPrimitiveT;
	      } catch {
	        const error = "invalid action_json";
	        await tx.run(
	          `UPDATE execution_steps
	           SET status = 'failed'
	           WHERE step_id = ? AND status = 'queued'`,
	          [next.step_id],
	        );
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
	           ) VALUES (?, ?, ?, 'failed', ?, ?, '[]', NULL, ?)`,
	          [attemptId, next.step_id, attemptNum, clock.nowIso, clock.nowIso, error],
	        );
	        await tx.run(
	          `UPDATE execution_runs
	           SET status = 'failed', finished_at = ?
	           WHERE run_id = ?`,
	          [clock.nowIso, run.run_id],
	        );
	        await tx.run(
	          `UPDATE execution_jobs
	           SET status = 'failed'
	           WHERE job_id = ?`,
	          [run.job_id],
	        );
	        await tx.run(
	          `DELETE FROM lane_leases
	           WHERE key = ? AND lane = ? AND lease_owner = ?`,
	          [run.key, run.lane, input.workerId],
	        );
	        await tx.run(
	          `DELETE FROM workspace_leases
	           WHERE workspace_id = ? AND lease_owner = ?`,
	          [run.workspace_id, input.workerId],
	        );
	        return { kind: "policy_denied" as const, error };
	      }

	      const policyEval = evaluateAction(policy, action, provenance);

	      if (policyEval.decision === "deny") {
	        const error = policyEval.reasons.map((r) => r.message).join("; ") || "action denied by policy";
	        await tx.run(
	          `UPDATE execution_steps
	           SET status = 'failed'
	           WHERE step_id = ? AND status = 'queued'`,
	          [next.step_id],
	        );
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
	             error,
	             metadata_json
	           ) VALUES (?, ?, ?, 'failed', ?, ?, '[]', NULL, ?, ?)`,
	          [
	            attemptId,
	            next.step_id,
	            attemptNum,
	            clock.nowIso,
	            clock.nowIso,
	            error,
	            JSON.stringify({ policy: { decision: policyEval.decision, reasons: policyEval.reasons } }),
	          ],
	        );
	        await tx.run(
	          `UPDATE execution_steps
	           SET status = 'cancelled'
	           WHERE run_id = ? AND status = 'queued'`,
	          [run.run_id],
	        );
	        await tx.run(
	          `UPDATE execution_runs
	           SET status = 'failed', finished_at = ?
	           WHERE run_id = ?`,
	          [clock.nowIso, run.run_id],
	        );
	        await tx.run(
	          `UPDATE execution_jobs
	           SET status = 'failed'
	           WHERE job_id = ?`,
	          [run.job_id],
	        );
	        await tx.run(
	          `DELETE FROM lane_leases
	           WHERE key = ? AND lane = ? AND lease_owner = ?`,
	          [run.key, run.lane, input.workerId],
	        );
	        await tx.run(
	          `DELETE FROM workspace_leases
	           WHERE workspace_id = ? AND lease_owner = ?`,
	          [run.workspace_id, input.workerId],
	        );
	        return { kind: "policy_denied" as const, error };
	      }

	      if (policyEval.decision === "require_approval") {
	        const existingApprovalId = next.approval_id;
	        if (existingApprovalId) {
	          const row = await tx.get<{ status: string }>(
	            "SELECT status FROM approvals WHERE id = ?",
	            [existingApprovalId],
	          );
	          const status = row?.status;
	          if (status === "approved") {
	            // Allow this step to proceed; it has an approved gate.
	          } else if (status === "denied" || status === "expired") {
	            const error = `approval ${String(existingApprovalId)} is ${status}`;
	            await tx.run(
	              `UPDATE execution_steps
	               SET status = 'cancelled'
	               WHERE step_id = ? AND status = 'queued'`,
	              [next.step_id],
	            );
	            await tx.run(
	              `UPDATE execution_steps
	               SET status = 'cancelled'
	               WHERE run_id = ? AND status = 'queued'`,
	              [run.run_id],
	            );
	            await tx.run(
	              `UPDATE execution_runs
	               SET status = 'cancelled', finished_at = ?
	               WHERE run_id = ?`,
	              [clock.nowIso, run.run_id],
	            );
	            await tx.run(
	              `UPDATE execution_jobs
	               SET status = 'cancelled'
	               WHERE job_id = ?`,
	              [run.job_id],
	            );
	            await tx.run(
	              `DELETE FROM lane_leases
	               WHERE key = ? AND lane = ? AND lease_owner = ?`,
	              [run.key, run.lane, input.workerId],
	            );
	            await tx.run(
	              `DELETE FROM workspace_leases
	               WHERE workspace_id = ? AND lease_owner = ?`,
	              [run.workspace_id, input.workerId],
	            );
	            return { kind: "policy_denied" as const, error };
	          } else {
	            await tx.run(
	              `UPDATE execution_runs
	               SET status = 'paused', paused_reason = ?, paused_detail = ?
	               WHERE run_id = ?`,
	              ["approval", this.redactText(`waiting for approval ${String(existingApprovalId)}`), run.run_id],
	            );
	            await tx.run(
	              `UPDATE execution_steps
	               SET status = 'paused'
	               WHERE step_id = ? AND status = 'queued'`,
	              [next.step_id],
	            );
	            const token = `resume-${randomUUID()}`;
	            await tx.run(
	              `INSERT INTO resume_tokens (token, run_id, created_at)
	               VALUES (?, ?, ?)`,
	              [token, run.run_id, clock.nowIso],
	            );
	            await tx.run(
	              `DELETE FROM lane_leases
	               WHERE key = ? AND lane = ? AND lease_owner = ?`,
	              [run.key, run.lane, input.workerId],
	            );
	            await tx.run(
	              `DELETE FROM workspace_leases
	               WHERE workspace_id = ? AND lease_owner = ?`,
	              [run.workspace_id, input.workerId],
	            );
	            return { kind: "paused" as const };
	          }
	        } else {
	          const token = `resume-${randomUUID()}`;
	          const prompt =
	            policyEval.reasons.length > 0
	              ? `Approve workflow step '${action.type}' (${policyEval.reasons.map((r) => r.message).join("; ")})`
	              : `Approve workflow step '${action.type}'`;

	          const approval = await new ApprovalDal(tx).create({
	            planId,
	            stepIndex: next.step_index,
	            prompt,
	            context: {
	              source: "execution-engine-policy",
	              kind: "workflow_step",
	              run_id: run.run_id,
	              step_id: next.step_id,
	              key: run.key,
	              lane: run.lane,
	              workspace_id: run.workspace_id,
	              action,
	              resume_token: token,
	              policy: {
	                snapshot_id: policySnapshotId,
	                snapshot_hash: policySnapshotHash,
	                decision: policyEval.decision,
	                reasons: policyEval.reasons,
	              },
	            },
	          });

	          await tx.run(
	            `UPDATE execution_runs
	             SET status = 'paused', paused_reason = ?, paused_detail = ?
	             WHERE run_id = ?`,
	            ["approval", this.redactText(prompt), run.run_id],
	          );
	          await tx.run(
	            `UPDATE execution_steps
	             SET status = 'paused', approval_id = ?
	             WHERE step_id = ? AND status = 'queued'`,
	            [approval.id, next.step_id],
	          );
	          await tx.run(
	            `INSERT INTO resume_tokens (token, run_id, created_at)
	             VALUES (?, ?, ?)`,
	            [token, run.run_id, clock.nowIso],
	          );
	          await tx.run(
	            `DELETE FROM lane_leases
	             WHERE key = ? AND lane = ? AND lease_owner = ?`,
	            [run.key, run.lane, input.workerId],
	          );
	          await tx.run(
	            `DELETE FROM workspace_leases
	             WHERE workspace_id = ? AND lease_owner = ?`,
	            [run.workspace_id, input.workerId],
	          );

	          return { kind: "paused" as const, approval };
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

      await tx.run(
        `UPDATE workspace_leases
         SET lease_expires_at_ms = ?
         WHERE workspace_id = ? AND lease_owner = ?`,
        [clock.nowMs + leaseTtlMs, run.workspace_id, input.workerId],
      );

	      return {
	        kind: "claimed" as const,
	        runId: run.run_id,
	        jobId: run.job_id,
	        key: run.key,
	        lane: run.lane,
	        triggerJson: run.trigger_json,
	        step: next,
	        action,
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

	    if (outcome.kind === "policy_denied") {
	      this.logger?.info("execution.attempt.denied", {
	        job_id: run.job_id,
	        run_id: run.run_id,
	        plan_id: planId,
	        error: this.redactText(outcome.error),
	      });
	      return true;
	    }

	    if (outcome.kind === "paused") {
	      if (outcome.approval) {
	        this.logger?.info("approval.created", {
	          approval_id: outcome.approval.id,
	          plan_id: outcome.approval.plan_id,
	          step_index: outcome.approval.step_index,
	          expires_at: outcome.approval.expires_at,
	        });
	        try {
	          this.approvalNotifier.notify(outcome.approval);
	        } catch {
	          // best-effort
	        }
	      }
	      this.logger?.info("execution.attempt.paused", {
	        job_id: run.job_id,
	        run_id: run.run_id,
	        plan_id: planId,
	        reason: "approval",
	      });
	      return true;
	    }

	    const timeoutMs = Math.max(1, outcome.step.timeout_ms);

	    return await this.executeAttempt({
	      planId,
	      stepIndex: outcome.step.step_index,
	      action: outcome.action,
	      postconditionJson: outcome.step.postcondition_json,
	      maxAttempts: outcome.step.max_attempts,
	      timeoutMs,
	      runId: outcome.runId,
      jobId: outcome.jobId,
      workspaceId: run.workspace_id,
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
    workspaceId: string;
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
    const cost = this.redactUnknown(
      result.cost
        ? { ...result.cost, duration_ms: result.cost?.duration_ms ?? wallDurationMs }
        : { duration_ms: wallDurationMs },
    );
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
              await this.persistAttemptArtifactsMetadata({
                key: opts.key,
                workspaceId: opts.workspaceId,
                runId: opts.runId,
                stepId: opts.stepId,
                attemptId: opts.attemptId,
                planId: opts.planId,
                artifacts: result.artifacts,
              });
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
        await this.persistAttemptArtifactsMetadata({
          key: opts.key,
          workspaceId: opts.workspaceId,
          runId: opts.runId,
          stepId: opts.stepId,
          attemptId: opts.attemptId,
          planId: opts.planId,
          artifacts: result.artifacts,
        });
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
      await this.persistAttemptArtifactsMetadata({
        key: opts.key,
        workspaceId: opts.workspaceId,
        runId: opts.runId,
        stepId: opts.stepId,
        attemptId: opts.attemptId,
        planId: opts.planId,
        artifacts: result.artifacts,
      });
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

    await this.persistAttemptArtifactsMetadata({
      key: opts.key,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      stepId: opts.stepId,
      attemptId: opts.attemptId,
      planId: opts.planId,
      artifacts: result.artifacts,
    });

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
    workspaceId: string;
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

    await this.releaseWorkspaceLease({
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });

    return true;
  }

  private async pauseRunAndStep(
    opts: {
      runId: string;
      stepId: string;
      jobId: string;
      workspaceId: string;
      key: string;
      lane: string;
      workerId: string;
    },
    reason: string,
    detail: string,
  ): Promise<string> {
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

    await this.releaseWorkspaceLease({
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });

    return token;
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
      const inserted = await tx.run(
        `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (key, lane) DO NOTHING`,
        [opts.key, opts.lane, opts.owner, expiresAt],
      );
      if (inserted.changes === 1) return true;

      const updated = await tx.run(
        `UPDATE lane_leases
         SET lease_owner = ?, lease_expires_at_ms = ?
         WHERE key = ? AND lane = ?
           AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
        [opts.owner, expiresAt, opts.key, opts.lane, opts.nowMs, opts.owner],
      );
      return updated.changes === 1;
    });
  }

  private async tryAcquireWorkspaceLease(opts: {
    workspaceId: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<boolean> {
    const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
    return await this.db.transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO workspace_leases (workspace_id, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [opts.workspaceId, opts.owner, expiresAt],
      );
      if (inserted.changes === 1) return true;

      const updated = await tx.run(
        `UPDATE workspace_leases
         SET lease_owner = ?, lease_expires_at_ms = ?
         WHERE workspace_id = ?
           AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
        [opts.owner, expiresAt, opts.workspaceId, opts.nowMs, opts.owner],
      );
      return updated.changes === 1;
    });
  }

  private async releaseWorkspaceLease(opts: { workspaceId: string; owner: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM workspace_leases
       WHERE workspace_id = ? AND lease_owner = ?`,
      [opts.workspaceId, opts.owner],
    );
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
