import type { SqlDb } from "../../src/statestore/types.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

type SeedExecutionRunParams = {
  db: SqlDb;
  tenantId?: string;
  agentId?: string;
  workspaceId?: string;
  jobId: string;
  runId: string;
  key?: string;
  lane?: string;
  jobStatus?: string;
  runStatus?: string;
  attempt?: number;
  pausedReason?: string | null;
  pausedDetail?: string | null;
  triggerJson?: string;
  inputJson?: string;
  latestRunId?: string | null;
};

type SeedApprovalLinkedExecutionRunParams = Omit<SeedExecutionRunParams, "jobId"> & {
  jobId?: string;
};

export async function seedPausedExecutionRun({
  db,
  tenantId = DEFAULT_TENANT_ID,
  agentId = DEFAULT_AGENT_ID,
  workspaceId = DEFAULT_WORKSPACE_ID,
  jobId,
  runId,
  key = "agent:agent-1:telegram-1:group:thread-1",
  lane = "main",
  jobStatus = "queued",
  runStatus = "paused",
  attempt = 1,
  pausedReason = null,
  pausedDetail = null,
  triggerJson = "{}",
  inputJson = "{}",
  latestRunId = runId,
}: SeedExecutionRunParams): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      jobId,
      agentId,
      workspaceId,
      key,
      lane,
      jobStatus,
      triggerJson,
      inputJson,
      latestRunId,
    ],
  );

  await db.run(
    `INSERT INTO execution_runs (
       tenant_id,
       run_id,
       job_id,
       key,
       lane,
       status,
       attempt,
       paused_reason,
       paused_detail
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, runId, jobId, key, lane, runStatus, attempt, pausedReason, pausedDetail],
  );
}

export async function seedApprovalLinkedExecutionRun({
  jobId,
  runId,
  ...params
}: SeedApprovalLinkedExecutionRunParams): Promise<void> {
  await seedPausedExecutionRun({
    ...params,
    jobId: jobId ?? `job-${runId}`,
    runId,
  });
}
