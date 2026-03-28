import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import type { StepClaimOutcome } from "@tyrum/runtime-execution";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../../statestore/types.js";
import { releaseConversationAndWorkspaceLeasesTx } from "./concurrency-manager.js";
import { claimQueuedStepExecutionTx } from "./step-execution-queued-claim.js";
import {
  finalizeRunWithoutQueuedStepTx,
  recoverExpiredRunningStepTx,
} from "./step-execution-state.js";
import { type RunnableRunRow, type StepRow } from "./shared.js";
import type { ExecutionApprovalPort, ExecutionClock, ExecutionConcurrencyLimits } from "./types.js";

export type { StepClaimOutcome } from "@tyrum/runtime-execution";

export interface StepExecutionClaimDeps {
  db: SqlDb;
  logger?: Logger;
  policyService?: PolicyService;
  approvalManager: ExecutionApprovalPort<SqlDb>;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  redactText(text: string): string;
  redactUnknown<T>(value: T): T;
  emitTurnUpdatedTx(tx: SqlDb, runId: string): Promise<void>;
  emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void>;
  emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void>;
  emitTurnStartedTx(tx: SqlDb, runId: string): Promise<void>;
  emitTurnCompletedTx(tx: SqlDb, runId: string): Promise<void>;
  emitTurnFailedTx(tx: SqlDb, runId: string): Promise<void>;
  isApprovedPolicyGateTx(tx: SqlDb, tenantId: string, approvalId: string | null): Promise<boolean>;
  resolveSecretScopesFromArgs(
    tenantId: string,
    args: unknown,
    context?: { runId?: string; stepId?: string; attemptId?: string },
  ): Promise<string[]>;
  maybePauseForToolIntentGuardrailTx(
    tx: SqlDb,
    opts: {
      run: RunnableRunRow;
      step: StepRow;
      actionType: ActionPrimitiveT["type"] | undefined;
      action: ActionPrimitiveT | undefined;
      clock: ExecutionClock;
      workerId: string;
    },
  ): Promise<{ approvalId: string } | undefined>;
}

export async function claimStepExecution(
  deps: StepExecutionClaimDeps,
  run: RunnableRunRow,
  workerId: string,
  clock: ExecutionClock,
): Promise<StepClaimOutcome> {
  return await deps.db.transaction(async (tx) => {
    const current = await tx.get<{
      run_status: string;
      job_status: string;
      started_at: string | Date | null;
    }>(
      `SELECT r.status AS run_status, j.status AS job_status, r.started_at AS started_at
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.tenant_id = ? AND r.turn_id = ?`,
      [run.tenant_id, run.run_id],
    );
    if (!current) {
      return { kind: "noop" };
    }
    if (current.run_status === "cancelled" || current.job_status === "cancelled") {
      await releaseConversationAndWorkspaceLeasesTx(tx, {
        tenantId: run.tenant_id,
        key: run.key,
        workspaceId: run.workspace_id,
        owner: workerId,
      });
      return { kind: "cancelled" };
    }

    if (run.status === "queued") {
      const shouldEmitRunStarted = current.started_at === null;
      const updated = await tx.run(
        `UPDATE turns
         SET status = 'running', started_at = COALESCE(started_at, ?)
         WHERE tenant_id = ? AND turn_id = ? AND status = 'queued'`,
        [clock.nowIso, run.tenant_id, run.run_id],
      );
      if (updated.changes === 1) {
        await deps.emitTurnUpdatedTx(tx, run.run_id);
        if (shouldEmitRunStarted) {
          await deps.emitTurnStartedTx(tx, run.run_id);
        }
      }
    }

    await tx.run(
      `UPDATE turn_jobs
       SET status = 'running'
       WHERE tenant_id = ? AND job_id = ? AND status = 'queued'`,
      [run.tenant_id, run.job_id],
    );

    const next = await tx.get<StepRow>(
      `SELECT
         tenant_id,
         step_id,
         turn_id AS run_id,
         step_index,
         status,
         action_json,
         created_at,
         idempotency_key,
         postcondition_json,
         approval_id,
         max_attempts,
         timeout_ms
       FROM execution_steps
       WHERE tenant_id = ? AND turn_id = ? AND status IN ('queued', 'running', 'paused')
       ORDER BY step_index ASC
       LIMIT 1`,
      [run.tenant_id, run.run_id],
    );

    if (!next) {
      return await finalizeRunWithoutQueuedStepTx({ deps, tx, run, workerId, clock });
    }

    if (next.status === "paused") {
      return { kind: "noop" };
    }

    if (next.status === "running") {
      return await recoverExpiredRunningStepTx({ deps, tx, run, next, workerId, clock });
    }
    return await claimQueuedStepExecutionTx({ deps, tx, run, next, workerId, clock });
  });
}
