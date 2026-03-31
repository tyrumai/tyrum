import type { SqlDb } from "../../../statestore/types.js";
import { clearTurnLeaseStateTx, recordTurnProgressTx } from "@tyrum/runtime-execution";
import {
  releaseConcurrencySlotsTx,
  releaseConversationAndWorkspaceLeasesTx,
} from "./concurrency-manager.js";
import type { StepClaimOutcome, StepExecutionClaimDeps } from "./step-execution.js";
import type { RunnableTurnRow, StepRow } from "./shared.js";
import type { ExecutionClock } from "./types.js";

interface StepClaimTxContext {
  deps: StepExecutionClaimDeps;
  tx: SqlDb;
  run: RunnableTurnRow;
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
    "SELECT status FROM execution_steps WHERE tenant_id = ? AND turn_id = ?",
    [run.tenant_id, run.turn_id],
  );
  const failed = statuses.some((s) => s.status === "failed" || s.status === "cancelled");

  const runUpdated = await tx.run(
    `UPDATE turns
     SET status = ?, finished_at = ?
     WHERE tenant_id = ? AND turn_id = ? AND status IN ('running', 'queued')`,
    [failed ? "failed" : "succeeded", clock.nowIso, run.tenant_id, run.turn_id],
  );
  await clearTurnLeaseStateTx(tx, {
    tenantId: run.tenant_id,
    turnId: run.turn_id,
  });
  await deps.emitTurnUpdatedTx(tx, run.turn_id);
  if (runUpdated.changes === 1) {
    await recordTurnProgressTx(tx, {
      tenantId: run.tenant_id,
      turnId: run.turn_id,
      at: clock.nowIso,
      progress: {
        kind: failed ? "turn.failed" : "turn.completed",
      },
    });
    if (failed) {
      await deps.emitTurnFailedTx(tx, run.turn_id);
    } else {
      await deps.emitTurnCompletedTx(tx, run.turn_id);
    }
  }

  await tx.run(
    `UPDATE turn_jobs
     SET status = ?
     WHERE tenant_id = ? AND job_id = ? AND status IN ('queued', 'running')`,
    [failed ? "failed" : "completed", run.tenant_id, run.job_id],
  );
  await releaseConversationAndWorkspaceLeasesTx(tx, {
    tenantId: run.tenant_id,
    key: run.key,
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
  await clearTurnLeaseStateTx(tx, {
    tenantId: next.tenant_id,
    turnId: next.turn_id,
  });
  await recordTurnProgressTx(tx, {
    tenantId: next.tenant_id,
    turnId: next.turn_id,
    at: clock.nowIso,
    progress: {
      kind: "execution.lease_expired",
      step_id: next.step_id,
      attempt_id: latestAttempt.attempt_id,
    },
  });
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
