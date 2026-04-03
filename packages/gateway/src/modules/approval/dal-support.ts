import type { ReviewEntry } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import type { ApprovalRow, RawApprovalRow } from "./dal.js";
import type { ApprovalStatus } from "./status.js";
import { normalizeApprovalKind, normalizeApprovalStatus } from "./status.js";

function parseJsonOrEmpty(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: approval context is optional persisted metadata; fall back to an empty object.
    return {};
  }
}

function joinPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function toApprovalRow(input: {
  raw: RawApprovalRow;
  latestReview?: ReviewEntry | null;
  reviews?: ReviewEntry[];
}): ApprovalRow {
  const { raw, latestReview, reviews } = input;
  return {
    tenant_id: raw.tenant_id,
    approval_id: raw.approval_id,
    approval_key: raw.approval_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    kind: normalizeApprovalKind(raw.kind),
    status: normalizeApprovalStatus(raw.status),
    prompt: raw.prompt,
    motivation: raw.motivation,
    context: parseJsonOrEmpty(raw.context_json),
    created_at: normalizeDbDateTime(raw.created_at) ?? new Date().toISOString(),
    expires_at: normalizeDbDateTime(raw.expires_at),
    latest_review: latestReview ?? null,
    ...(reviews ? { reviews } : {}),
    conversation_id: raw.conversation_id,
    plan_id: raw.plan_id,
    turn_id: raw.turn_id,
    turn_item_id: raw.turn_item_id,
    workflow_run_step_id: raw.workflow_run_step_id,
    step_id: raw.step_id,
    attempt_id: raw.attempt_id,
    work_item_id: raw.work_item_id,
    work_item_task_id: raw.work_item_task_id,
    resume_token: raw.resume_token,
  };
}

export async function expireStaleApprovals(
  tx: SqlDb,
  input: { tenantId: string; nowIso: string },
): Promise<number> {
  const transitionedRows = await tx.all<{ approval_id: string }>(
    `UPDATE approvals
     SET status = 'expired'
     WHERE tenant_id = ?
       AND expires_at IS NOT NULL
       AND expires_at <= ?
       AND status IN ('queued', 'reviewing', 'awaiting_human')
     RETURNING approval_id`,
    [input.tenantId, input.nowIso],
  );
  if (transitionedRows.length === 0) {
    return 0;
  }

  const reason = "approval timed out";
  const reviewAssignments = transitionedRows.map((row) => ({
    approvalId: row.approval_id,
    reviewId: randomUUID(),
  }));
  const reviewTuples = reviewAssignments.map(
    () => "(?, ?, 'approval', ?, 'system', NULL, 'expired', ?, NULL, NULL, NULL, NULL, ?, NULL, ?)",
  );
  const reviewParams = reviewAssignments.flatMap((assignment) => [
    input.tenantId,
    assignment.reviewId,
    assignment.approvalId,
    reason,
    input.nowIso,
    input.nowIso,
  ]);
  const inserted = await tx.run(
    `INSERT INTO review_entries (
       tenant_id,
       review_id,
       target_type,
       target_id,
       reviewer_kind,
       reviewer_id,
       state,
       reason,
       risk_level,
       risk_score,
       evidence_json,
       decision_payload_json,
       created_at,
       started_at,
       completed_at
     )
     VALUES ${reviewTuples.join(", ")}`,
    reviewParams,
  );
  if (inserted.changes !== reviewAssignments.length) {
    throw new Error("failed to create approval expiry reviews");
  }

  const caseSql = reviewAssignments.map(() => "WHEN ? THEN ?").join(" ");
  const updated = await tx.run(
    `UPDATE approvals
     SET latest_review_id = CASE approval_id
       ${caseSql}
       ELSE latest_review_id
     END
     WHERE tenant_id = ?
       AND approval_id IN (${joinPlaceholders(reviewAssignments.length)})`,
    [
      ...reviewAssignments.flatMap((assignment) => [assignment.approvalId, assignment.reviewId]),
      input.tenantId,
      ...reviewAssignments.map((assignment) => assignment.approvalId),
    ],
  );
  if (updated.changes !== reviewAssignments.length) {
    throw new Error("failed to attach approval expiry reviews");
  }
  return reviewAssignments.length;
}

export async function getRawLatestApprovalByTurnId(input: {
  db: SqlDb;
  tenantId: string;
  turnId: string;
  statuses?: readonly ApprovalStatus[];
}): Promise<RawApprovalRow | undefined> {
  const turnId = input.turnId.trim();
  if (!turnId) return undefined;

  const statuses = [...new Set((input.statuses ?? []).map((status) => status.trim()))].filter(
    (status): status is ApprovalStatus => status.length > 0,
  );
  const whereStatus =
    statuses.length > 0 ? ` AND status IN (${buildSqlPlaceholders(statuses.length)})` : "";
  return await input.db.get<RawApprovalRow>(
    `SELECT tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            context_json,
            created_at,
            expires_at,
            latest_review_id,
            conversation_id AS conversation_id,
            plan_id,
            turn_id AS turn_id,
            turn_item_id,
            workflow_run_step_id,
            step_id,
            attempt_id,
            work_item_id,
            work_item_task_id,
            resume_token
       FROM approvals
       WHERE tenant_id = ? AND turn_id = ?${whereStatus}
       ORDER BY created_at DESC, approval_id DESC
       LIMIT 1`,
    [input.tenantId.trim(), turnId, ...statuses],
  );
}
