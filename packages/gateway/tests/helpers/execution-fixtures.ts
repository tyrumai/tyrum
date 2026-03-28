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
  turnId: string;
  conversationKey?: string;
  conversationId?: string | null;
  jobStatus?: string;
  runStatus?: string;
  attempt?: number;
  pausedReason?: string | null;
  pausedDetail?: string | null;
  triggerJson?: string;
  inputJson?: string;
  latestTurnId?: string | null;
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
  turnId,
  conversationKey = "agent:agent-1:telegram-1:group:thread-1",
  conversationId = null,
  jobStatus = "queued",
  runStatus = "paused",
  attempt = 1,
  pausedReason = null,
  pausedDetail = null,
  triggerJson = "{}",
  inputJson = "{}",
  latestTurnId = turnId,
}: SeedExecutionRunParams): Promise<void> {
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      jobId,
      agentId,
      workspaceId,
      conversationId,
      conversationKey,
      jobStatus,
      triggerJson,
      inputJson,
      latestTurnId,
    ],
  );

  await db.run(
    `INSERT INTO turns (
       tenant_id,
       turn_id,
       job_id,
       conversation_key,
       status,
       attempt,
       blocked_reason,
       blocked_detail
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, turnId, jobId, conversationKey, runStatus, attempt, pausedReason, pausedDetail],
  );
}

export async function seedApprovalLinkedExecutionRun({
  jobId,
  turnId,
  ...params
}: SeedApprovalLinkedExecutionRunParams): Promise<void> {
  await seedPausedExecutionRun({
    ...params,
    jobId: jobId ?? `job-${turnId}`,
    turnId,
  });
}
