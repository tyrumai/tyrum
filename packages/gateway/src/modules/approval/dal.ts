/**
 * Approval queue data access layer.
 *
 * Persists human approval requests to SQLite so they survive gateway restarts
 * and can be queried by the portal or CLI.
 */

import type Database from "better-sqlite3";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRow {
  id: number;
  plan_id: string;
  step_index: number;
  prompt: string;
  context: unknown;
  status: ApprovalStatus;
  created_at: string;
  responded_at: string | null;
  response_reason: string | null;
  expires_at: string | null;
}

interface RawApprovalRow {
  id: number;
  plan_id: string;
  step_index: number;
  prompt: string;
  context_json: string;
  status: string;
  created_at: string;
  responded_at: string | null;
  response_reason: string | null;
  expires_at: string | null;
}

function toApprovalRow(raw: RawApprovalRow): ApprovalRow {
  let context: unknown = {};
  try {
    context = JSON.parse(raw.context_json) as unknown;
  } catch {
    // leave as empty object
  }
  return {
    id: raw.id,
    plan_id: raw.plan_id,
    step_index: raw.step_index,
    prompt: raw.prompt,
    context,
    status: raw.status as ApprovalStatus,
    created_at: raw.created_at,
    responded_at: raw.responded_at,
    response_reason: raw.response_reason,
    expires_at: raw.expires_at,
  };
}

export interface CreateApprovalParams {
  planId: string;
  stepIndex: number;
  prompt: string;
  context?: unknown;
  expiresAt?: string;
}

export class ApprovalDal {
  constructor(private readonly db: Database.Database) {}

  /** Create a new pending approval request. */
  create(params: CreateApprovalParams): ApprovalRow {
    const contextJson = JSON.stringify(params.context ?? {});

    const result = this.db
      .prepare(
        `INSERT INTO approvals (plan_id, step_index, prompt, context_json, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.planId,
        params.stepIndex,
        params.prompt,
        contextJson,
        params.expiresAt ?? null,
      );

    const row = this.db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as RawApprovalRow;

    return toApprovalRow(row);
  }

  /** Respond to a pending approval (approve or deny). */
  respond(
    id: number,
    approved: boolean,
    reason?: string,
  ): ApprovalRow | undefined {
    const status: ApprovalStatus = approved ? "approved" : "denied";

    const changes = this.db
      .prepare(
        `UPDATE approvals
         SET status = ?, responded_at = datetime('now'), response_reason = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, reason ?? null, id);

    if (changes.changes === 0) return undefined;

    return this.getById(id);
  }

  /** Get a single approval by id. */
  getById(id: number): ApprovalRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(id) as RawApprovalRow | undefined;

    return row ? toApprovalRow(row) : undefined;
  }

  /** Get all pending approvals, ordered by creation time (oldest first). */
  getPending(): ApprovalRow[] {
    return this.getByStatus("pending");
  }

  /** Get approvals filtered by status, ordered by creation time (oldest first). */
  getByStatus(status: ApprovalStatus): ApprovalRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM approvals WHERE status = ? ORDER BY created_at ASC",
      )
      .all(status) as RawApprovalRow[];

    return rows.map(toApprovalRow);
  }

  /** Get all approvals for a given plan. */
  getByPlanId(planId: string): ApprovalRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM approvals WHERE plan_id = ? ORDER BY step_index ASC",
      )
      .all(planId) as RawApprovalRow[];

    return rows.map(toApprovalRow);
  }

  /**
   * Expire stale approvals whose `expires_at` has passed.
   * @returns the number of approvals expired.
   */
  expireStale(): number {
    const result = this.db
      .prepare(
        `UPDATE approvals
         SET status = 'expired', responded_at = datetime('now')
         WHERE status = 'pending'
           AND expires_at IS NOT NULL
           AND datetime(expires_at) <= datetime('now')`,
      )
      .run();

    return result.changes;
  }
}
