import type { SqlDb } from "../../../statestore/types.js";

export interface WorkflowRunStateFromTurnSyncInput {
  tenantId: string;
  workflowRunId: string;
  status: string;
  attempt: number;
  updatedAtIso: string;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  blockedReason: string | null;
  blockedDetail: string | null;
}

export async function syncWorkflowRunStateFromTurnTx(
  tx: SqlDb,
  input: WorkflowRunStateFromTurnSyncInput,
): Promise<void> {
  await tx.run(
    `UPDATE workflow_runs
     SET status = ?,
         attempt = ?,
         updated_at = ?,
         started_at = ?,
         finished_at = ?,
         blocked_reason = ?,
         blocked_detail = ?
     WHERE tenant_id = ?
       AND workflow_run_id = ?
       AND (status NOT IN ('cancelled', 'failed', 'succeeded') OR status = ?)`,
    [
      input.status,
      input.attempt,
      input.updatedAtIso,
      input.startedAt,
      input.finishedAt,
      input.blockedReason,
      input.blockedDetail,
      input.tenantId,
      input.workflowRunId,
      input.status,
    ],
  );
}
