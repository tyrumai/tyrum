import type { SqlDb } from "../../../statestore/types.js";
import { tryAcquireConversationLease } from "./concurrency-manager.js";
import type { RunnableTurnRow } from "./shared.js";
import { safeJsonParse } from "../../../utils/json.js";

type RunnableTurnCandidateRow = RunnableTurnRow & {
  step_count: number;
};

function isConversationTrigger(triggerJson: string): boolean {
  const parsed = safeJsonParse(triggerJson, undefined as unknown);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return true;
  }
  const kind = "kind" in parsed ? parsed.kind : undefined;
  return kind === "conversation";
}

export async function listRunnableTurnCandidates(
  db: SqlDb,
  turnId?: string,
): Promise<RunnableTurnRow[]> {
  const runIdFilter = turnId?.trim();
  const whereRunId = runIdFilter ? " AND r.turn_id = ?" : "";
  const params = runIdFilter ? [runIdFilter] : [];
  const limit = runIdFilter ? 1 : 10;

  const rows = await db.all<RunnableTurnCandidateRow>(
    `SELECT
       r.tenant_id,
       r.turn_id AS turn_id,
       r.job_id,
       j.agent_id,
       r.conversation_key AS key,
       r.status,
       j.trigger_json,
       j.workspace_id,
       r.policy_snapshot_id,
       r.lease_owner,
       r.lease_expires_at_ms,
       r.checkpoint_json,
       r.last_progress_at,
       r.last_progress_json,
       (
         SELECT COUNT(*)
         FROM execution_steps s
         WHERE s.tenant_id = r.tenant_id
           AND s.turn_id = r.turn_id
       ) AS step_count
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
  return rows
    .filter((row) => row.step_count > 0 || !isConversationTrigger(row.trigger_json))
    .map(({ step_count: _stepCount, ...row }) => row);
}

export async function tryAcquireTurnConversationLease(
  db: SqlDb,
  run: RunnableTurnRow,
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
