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

export async function resolveWorkflowRunStepIdForExecutionStep(input: {
  db: SqlDb;
  tenantId: string;
  turnId: string;
  stepId: string;
}): Promise<string | null> {
  const step = await input.db.get<{ step_index: number; tenant_id: string; turn_id: string }>(
    `SELECT step_index, tenant_id, turn_id
       FROM execution_steps
       WHERE step_id = ?
       LIMIT 1`,
    [input.stepId],
  );
  if (!step) {
    return null;
  }
  if (step.tenant_id !== input.tenantId || step.turn_id !== input.turnId) {
    return null;
  }
  return await resolveWorkflowRunStepIdTx({
    tx: input.db,
    tenantId: input.tenantId,
    turnId: input.turnId,
    stepIndex: step.step_index,
  });
}
