import type { SqlDb } from "../../../statestore/types.js";
import { tryAcquireLaneLease } from "./concurrency-manager.js";
import type { RunnableRunRow } from "./shared.js";

export async function listRunnableRunCandidates(
  db: SqlDb,
  runId?: string,
): Promise<RunnableRunRow[]> {
  const runIdFilter = runId?.trim();
  const whereRunId = runIdFilter ? " AND r.run_id = ?" : "";
  const params = runIdFilter ? [runIdFilter] : [];
  const limit = runIdFilter ? 1 : 10;

  return await db.all<RunnableRunRow>(
    `SELECT
       r.tenant_id,
       r.run_id,
       r.job_id,
       j.agent_id,
       r.key,
       r.lane,
       r.status,
       j.trigger_json,
       j.workspace_id,
       r.policy_snapshot_id
     FROM execution_runs r
     JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.status IN ('running', 'queued')
       AND NOT EXISTS (
         SELECT 1 FROM execution_runs p
         WHERE p.tenant_id = r.tenant_id
           AND p.key = r.key
           AND p.lane = r.lane
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

export async function tryAcquireRunLaneLease(
  db: SqlDb,
  run: RunnableRunRow,
  workerId: string,
  nowMs: number,
): Promise<boolean> {
  return await tryAcquireLaneLease(db, {
    tenantId: run.tenant_id,
    key: run.key,
    lane: run.lane,
    owner: workerId,
    nowMs,
    ttlMs: 60_000,
  });
}
