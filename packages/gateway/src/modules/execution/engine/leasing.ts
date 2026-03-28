import type { SqlDb } from "../../../statestore/types.js";
import { tryAcquireConversationLease } from "./concurrency-manager.js";
import type { RunnableRunRow } from "./shared.js";

export async function listRunnableRunCandidates(
  db: SqlDb,
  runId?: string,
): Promise<RunnableRunRow[]> {
  const runIdFilter = runId?.trim();
  const whereRunId = runIdFilter ? " AND r.turn_id = ?" : "";
  const params = runIdFilter ? [runIdFilter] : [];
  const limit = runIdFilter ? 1 : 10;

  return await db.all<RunnableRunRow>(
    `SELECT
       r.tenant_id,
       r.turn_id AS run_id,
       r.job_id,
       j.agent_id,
       r.conversation_key AS key,
       r.status,
       j.trigger_json,
       j.workspace_id,
       r.policy_snapshot_id
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.status IN ('running', 'queued')
       AND NOT EXISTS (
         SELECT 1 FROM turns p
         WHERE p.tenant_id = r.tenant_id
           AND p.conversation_key = r.conversation_key
           AND p.status = 'paused'
       )
       ${whereRunId}
     ORDER BY
       CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
       r.created_at ASC
     LIMIT ${String(limit)}`,
    params,
  );
}

export async function tryAcquireRunConversationLease(
  db: SqlDb,
  run: RunnableRunRow,
  workerId: string,
  nowMs: number,
): Promise<boolean> {
  return await tryAcquireConversationLease(db, {
    tenantId: run.tenant_id,
    key: run.key,
    owner: workerId,
    nowMs,
    ttlMs: 60_000,
  });
}
