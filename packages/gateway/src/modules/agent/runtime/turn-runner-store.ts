import type {
  TurnStatus as TurnStatusT,
  TurnTriggerKind as TurnTriggerKindT,
} from "@tyrum/contracts";
import { TurnStatus, TurnTriggerKind } from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";

type RawTurnRunnerRow = {
  tenant_id: string;
  turn_id: string;
  job_id: string;
  conversation_key: string;
  status: string;
  attempt: number;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  budget_overridden_at: string | Date | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint_json: string | null;
  last_progress_at: string | Date | null;
  last_progress_json: string | null;
  trigger_json: string | null;
};

export interface TurnRunnerTurn {
  tenant_id: string;
  turn_id: string;
  job_id: string;
  conversation_key: string;
  status: TurnStatusT;
  attempt: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  budget_overridden_at: string | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint: unknown | null;
  last_progress_at: string | null;
  last_progress: Record<string, unknown> | null;
  trigger_kind: TurnTriggerKindT | undefined;
}

export const DEFAULT_TURN_RUNNER_SCAN_LIMIT = 25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTriggerKind(raw: string | null): TurnTriggerKindT | undefined {
  const parsed = safeJsonParse(raw, undefined as unknown);
  if (!isRecord(parsed)) {
    return undefined;
  }
  const triggerKind = TurnTriggerKind.safeParse(parsed["kind"]);
  return triggerKind.success ? triggerKind.data : undefined;
}

function parseProgress(raw: string | null): Record<string, unknown> | null {
  const parsed = safeJsonParse(raw, null as Record<string, unknown> | null);
  return isRecord(parsed) ? parsed : null;
}

function toTurn(raw: RawTurnRunnerRow): TurnRunnerTurn {
  const parsedStatus = TurnStatus.safeParse(raw.status);
  if (!parsedStatus.success) {
    throw new Error(`invalid turn status '${raw.status}'`);
  }

  return {
    tenant_id: raw.tenant_id,
    turn_id: raw.turn_id,
    job_id: raw.job_id,
    conversation_key: raw.conversation_key,
    status: parsedStatus.data,
    attempt: raw.attempt,
    created_at: normalizeDbDateTime(raw.created_at) ?? new Date().toISOString(),
    started_at: normalizeDbDateTime(raw.started_at),
    finished_at: normalizeDbDateTime(raw.finished_at),
    blocked_reason: raw.blocked_reason,
    blocked_detail: raw.blocked_detail,
    budget_overridden_at: normalizeDbDateTime(raw.budget_overridden_at),
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    checkpoint: safeJsonParse(raw.checkpoint_json, null as unknown),
    last_progress_at: normalizeDbDateTime(raw.last_progress_at),
    last_progress: parseProgress(raw.last_progress_json),
    trigger_kind: parseTriggerKind(raw.trigger_json),
  };
}

async function listTurns(
  db: Pick<SqlDb, "all">,
  sql: string,
  params: readonly unknown[],
): Promise<TurnRunnerTurn[]> {
  return (await db.all<RawTurnRunnerRow>(sql, params))
    .map((row) => toTurn(row))
    .filter((turn) => turn.trigger_kind === "conversation");
}

export async function getTurnTx(
  tx: Pick<SqlDb, "get">,
  tenantId: string,
  turnId: string,
): Promise<TurnRunnerTurn | undefined> {
  const row = await tx.get<RawTurnRunnerRow>(
    `SELECT
       r.tenant_id,
       r.turn_id,
       r.job_id,
       r.conversation_key,
       r.status,
       r.attempt,
       r.created_at,
       r.started_at,
       r.finished_at,
       r.blocked_reason,
       r.blocked_detail,
       r.budget_overridden_at,
       r.lease_owner,
       r.lease_expires_at_ms,
       r.checkpoint_json,
       r.last_progress_at,
       r.last_progress_json,
       j.trigger_json
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.tenant_id = ? AND r.turn_id = ?`,
    [tenantId, turnId],
  );
  return row ? toTurn(row) : undefined;
}

export async function listPausedConversationTurns(
  db: Pick<SqlDb, "all">,
  tenantId: string,
  limit = DEFAULT_TURN_RUNNER_SCAN_LIMIT,
): Promise<TurnRunnerTurn[]> {
  return await listTurns(
    db,
    `SELECT
       r.tenant_id,
       r.turn_id,
       r.job_id,
       r.conversation_key,
       r.status,
       r.attempt,
       r.created_at,
       r.started_at,
       r.finished_at,
       r.blocked_reason,
       r.blocked_detail,
       r.budget_overridden_at,
       r.lease_owner,
       r.lease_expires_at_ms,
       r.checkpoint_json,
       r.last_progress_at,
       r.last_progress_json,
       j.trigger_json
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.tenant_id = ?
       AND r.status = 'paused'
       AND NOT EXISTS (
         SELECT 1
         FROM execution_steps s
         WHERE s.tenant_id = r.tenant_id
           AND s.turn_id = r.turn_id
       )
     ORDER BY r.created_at ASC, r.turn_id ASC
     LIMIT ?`,
    [tenantId, Math.max(1, limit)],
  );
}

export async function listRunnableConversationTurns(
  db: Pick<SqlDb, "all">,
  tenantId: string,
  limit = DEFAULT_TURN_RUNNER_SCAN_LIMIT,
): Promise<TurnRunnerTurn[]> {
  return await listTurns(
    db,
    `SELECT
       r.tenant_id,
       r.turn_id,
       r.job_id,
       r.conversation_key,
       r.status,
       r.attempt,
       r.created_at,
       r.started_at,
       r.finished_at,
       r.blocked_reason,
       r.blocked_detail,
       r.budget_overridden_at,
       r.lease_owner,
       r.lease_expires_at_ms,
       r.checkpoint_json,
       r.last_progress_at,
       r.last_progress_json,
       j.trigger_json
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.tenant_id = ?
       AND r.status IN ('queued', 'running')
       AND NOT EXISTS (
         SELECT 1
         FROM execution_steps s
         WHERE s.tenant_id = r.tenant_id
           AND s.turn_id = r.turn_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM turns p
         WHERE p.tenant_id = r.tenant_id
           AND p.conversation_key = r.conversation_key
           AND p.status = 'paused'
       )
     ORDER BY
       CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
       r.created_at ASC,
       r.turn_id ASC
     LIMIT ?`,
    [tenantId, Math.max(1, limit)],
  );
}
