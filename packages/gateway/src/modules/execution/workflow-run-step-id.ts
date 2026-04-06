import type { SqlDb } from "../../statestore/types.js";

export async function resolveWorkflowRunStepIdTx(input: {
  tx: SqlDb;
  tenantId: string;
  turnId: string;
  stepIndex: number;
}): Promise<string | null> {
  const row = await input.tx.get<{ workflow_run_step_id: string | null }>(
    `SELECT workflow_run_step_id
       FROM workflow_run_steps
       WHERE tenant_id = ? AND workflow_run_id = ? AND step_index = ?
       LIMIT 1`,
    [input.tenantId, input.turnId, input.stepIndex],
  );
  return row?.workflow_run_step_id ?? null;
}
