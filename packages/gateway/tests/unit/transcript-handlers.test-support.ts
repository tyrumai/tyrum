import type { SqliteDb } from "../../src/statestore/sqlite.js";

export async function linkSubagentSession(input: {
  db: SqliteDb;
  tenantId: string;
  sessionId: string;
  sessionKey: string;
  subagentId: string;
  agentId: string;
  workspaceId: string;
  parentSessionKey: string;
  createdAt: string;
  updatedAt?: string;
  status?: string;
}): Promise<void> {
  await input.db.run("UPDATE sessions SET session_key = ? WHERE tenant_id = ? AND session_id = ?", [
    input.sessionKey,
    input.tenantId,
    input.sessionId,
  ]);
  await input.db.run(
    `INSERT INTO subagents (
       subagent_id,
       tenant_id,
       agent_id,
       workspace_id,
       parent_session_key,
       work_item_id,
       work_item_task_id,
       execution_profile,
       session_key,
       lane,
       status,
       desktop_environment_id,
       attached_node_id,
       created_at,
       updated_at,
       last_heartbeat_at,
       closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.subagentId,
      input.tenantId,
      input.agentId,
      input.workspaceId,
      input.parentSessionKey,
      null,
      null,
      "executor",
      input.sessionKey,
      "subagent",
      input.status ?? "running",
      null,
      null,
      input.createdAt,
      input.updatedAt ?? input.createdAt,
      null,
      null,
    ],
  );
}

export async function insertRunningExecution(input: {
  db: SqliteDb;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  sessionKey: string;
  sessionId?: string;
  jobId: string;
  runId: string;
  createdAt: string;
}): Promise<void> {
  await input.db.run(
    `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, session_id, key, lane, status, trigger_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.jobId,
      input.agentId,
      input.workspaceId,
      input.sessionId ?? null,
      input.sessionKey,
      "main",
      "running",
      "{}",
    ],
  );
  await input.db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.runId,
      input.jobId,
      input.sessionKey,
      "main",
      "running",
      1,
      input.createdAt,
    ],
  );
}

export async function insertRunningExecutionTrace(input: {
  db: SqliteDb;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  sessionKey: string;
  sessionId?: string;
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  createdAt: string;
}): Promise<void> {
  await insertRunningExecution(input);
  await input.db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.stepId,
      input.runId,
      0,
      "running",
      JSON.stringify({ type: "Research", args: {} }),
      input.createdAt,
    ],
  );
  await input.db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.tenantId, input.attemptId, input.stepId, 1, "running", input.createdAt],
  );
}
