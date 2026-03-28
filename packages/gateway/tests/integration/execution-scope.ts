export type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

export type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

export async function seedExecutionScope(db: SqlRunner, ids: ExecutionScopeIds): Promise<void> {
  await db.run(
    `INSERT INTO turn_jobs (job_id, conversation_key, status, trigger_json, input_json, latest_turn_id)
     VALUES (?, ?, 'running', ?, ?, ?)`,
    [ids.jobId, "agent:agent-1:thread:thread-1", "{}", "{}", ids.runId],
  );

  await db.run(
    `INSERT INTO turns (turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, 'running', 1)`,
    [ids.runId, ids.jobId, "agent:agent-1:thread:thread-1"],
  );

  await db.run(
    `INSERT INTO execution_steps (step_id, turn_id, step_index, status, action_json)
     VALUES (?, ?, 0, 'running', ?)`,
    [ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, 1, 'running', '[]')`,
    [ids.attemptId, ids.stepId],
  );
}
