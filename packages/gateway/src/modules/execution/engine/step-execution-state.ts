import type { SqlDb } from "../../../statestore/types.js";
import {
  releaseConcurrencySlotsTx,
  releaseLaneAndWorkspaceLeasesTx,
} from "./concurrency-manager.js";
import type { StepClaimOutcome, StepExecutionClaimDeps } from "./step-execution.js";
import type { RunnableRunRow, StepRow } from "./shared.js";
import type { ExecutionClock } from "./types.js";

interface StepClaimTxContext {
  deps: StepExecutionClaimDeps;
  tx: SqlDb;
  run: RunnableRunRow;
  workerId: string;
  clock: ExecutionClock;
}

export async function finalizeRunWithoutQueuedStepTx({
  deps,
  tx,
  run,
  workerId,
  clock,
}: StepClaimTxContext): Promise<StepClaimOutcome> {
  const statuses = await tx.all<{ status: string }>(
    "SELECT status FROM execution_steps WHERE tenant_id = ? AND run_id = ?",
    [run.tenant_id, run.run_id],
  );
  const failed = statuses.some((s) => s.status === "failed" || s.status === "cancelled");

  const runUpdated = await tx.run(
    `UPDATE execution_runs
     SET status = ?, finished_at = ?
     WHERE tenant_id = ? AND run_id = ? AND status IN ('running', 'queued')`,
    [failed ? "failed" : "succeeded", clock.nowIso, run.tenant_id, run.run_id],
  );
  await deps.emitRunUpdatedTx(tx, run.run_id);
  if (runUpdated.changes === 1) {
    if (failed) {
      await deps.emitRunFailedTx(tx, run.run_id);
    } else {
      await deps.emitRunCompletedTx(tx, run.run_id);
    }
  }

  await tx.run(
    `UPDATE execution_jobs
     SET status = ?
     WHERE tenant_id = ? AND job_id = ? AND status IN ('queued', 'running')`,
    [failed ? "failed" : "completed", run.tenant_id, run.job_id],
  );
  await releaseLaneAndWorkspaceLeasesTx(tx, {
    tenantId: run.tenant_id,
    key: run.key,
    lane: run.lane,
    workspaceId: run.workspace_id,
    owner: workerId,
  });

  return { kind: "finalized" };
}

export async function recoverExpiredRunningStepTx({
  deps,
  tx,
  next,
  clock,
}: StepClaimTxContext & { next: StepRow }): Promise<StepClaimOutcome> {
  const latestAttempt = await tx.get<{
    attempt_id: string;
    lease_expires_at_ms: number | null;
  }>(
    `SELECT attempt_id, lease_expires_at_ms
     FROM execution_attempts
     WHERE tenant_id = ? AND step_id = ? AND status = 'running'
     ORDER BY attempt DESC
     LIMIT 1`,
    [next.tenant_id, next.step_id],
  );

  const expiresAtMs = latestAttempt?.lease_expires_at_ms ?? 0;
  if (!latestAttempt || expiresAtMs > clock.nowMs) {
    return { kind: "noop" };
  }

  await tx.run(
    `UPDATE execution_attempts
     SET status = 'cancelled', finished_at = ?, error = ?
     WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
    [clock.nowIso, "lease expired; takeover", next.tenant_id, latestAttempt.attempt_id],
  );

  await tx.run(
    `UPDATE execution_steps
     SET status = 'queued'
     WHERE tenant_id = ? AND step_id = ? AND status = 'running'`,
    [next.tenant_id, next.step_id],
  );
  await deps.emitAttemptUpdatedTx(tx, latestAttempt.attempt_id);
  await releaseConcurrencySlotsTx(
    tx,
    next.tenant_id,
    latestAttempt.attempt_id,
    clock.nowIso,
    deps.concurrencyLimits,
  );
  await deps.emitStepUpdatedTx(tx, next.step_id);
  return { kind: "recovered" };
}
