/**
 * Approval queue data access layer.
 *
 * Persists human approval requests to SQLite so they survive gateway restarts
 * and can be queried by the portal or CLI.
 */

import type { SqlDb } from "../../statestore/types.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalRow {
  id: number;
  kind: string;
  agent_id: string | null;
  workspace_id: string;
  key: string | null;
  lane: string | null;
  run_id: string | null;
  resume_token: string | null;
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
  kind: string;
  agent_id: string | null;
  workspace_id: string;
  key: string | null;
  lane: string | null;
  run_id: string | null;
  resume_token: string | null;
  plan_id: string;
  step_index: number;
  prompt: string;
  context_json: string;
  status: string;
  created_at: string | Date;
  responded_at: string | Date | null;
  response_reason: string | null;
  expires_at: string | Date | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toApprovalRow(raw: RawApprovalRow): ApprovalRow {
  let context: unknown = {};
  try {
    context = JSON.parse(raw.context_json) as unknown;
  } catch {
    // Intentional: treat invalid JSON contexts as empty objects.
  }
  return {
    id: raw.id,
    kind: raw.kind,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    key: raw.key,
    lane: raw.lane,
    run_id: raw.run_id,
    resume_token: raw.resume_token,
    plan_id: raw.plan_id,
    step_index: raw.step_index,
    prompt: raw.prompt,
    context,
    status: raw.status as ApprovalStatus,
    created_at: normalizeTime(raw.created_at),
    responded_at: normalizeMaybeTime(raw.responded_at),
    response_reason: raw.response_reason,
    expires_at: normalizeMaybeTime(raw.expires_at),
  };
}

export interface CreateApprovalParams {
  planId: string;
  stepIndex: number;
  prompt: string;
  kind?: string;
  agentId?: string;
  workspaceId?: string;
  key?: string;
  lane?: string;
  runId?: string;
  resumeToken?: string;
  context?: unknown;
  expiresAt?: string;
}

export class ApprovalDal {
  constructor(private readonly db: SqlDb) {}

  /** Create a new pending approval request. */
  async create(params: CreateApprovalParams): Promise<ApprovalRow> {
    const contextJson = JSON.stringify(params.context ?? {});
    const kind = params.kind?.trim() || "other";
    const agentId = params.agentId?.trim() || null;
    const workspaceId = params.workspaceId?.trim() || "default";
    const key = params.key?.trim() || null;
    const lane = params.lane?.trim() || null;
    const runId = params.runId?.trim() || null;
    const resumeToken = params.resumeToken?.trim() || null;

    const row = await this.db.get<RawApprovalRow>(
      `INSERT INTO approvals (
         plan_id,
         step_index,
         prompt,
         context_json,
         expires_at,
         kind,
         agent_id,
         workspace_id,
         key,
         lane,
         run_id,
         resume_token
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.planId,
        params.stepIndex,
        params.prompt,
        contextJson,
        params.expiresAt ?? null,
        kind,
        agentId,
        workspaceId,
        key,
        lane,
        runId,
        resumeToken,
      ],
    );
    if (!row) {
      throw new Error("approval insert failed");
    }
    return toApprovalRow(row);
  }

  /** Respond to a pending approval (approve or deny). */
  async respond(id: number, approved: boolean, reason?: string): Promise<ApprovalRow | undefined> {
    const status: ApprovalStatus = approved ? "approved" : "denied";
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<RawApprovalRow>("SELECT * FROM approvals WHERE id = ?", [id]);
      if (!existing) return undefined;

      if (existing.status !== "pending") {
        return toApprovalRow(existing);
      }

      const result = await tx.run(
        `UPDATE approvals
         SET status = ?, responded_at = ?, response_reason = ?
         WHERE id = ? AND status = 'pending'`,
        [status, nowIso, reason ?? null, id],
      );

      if (result.changes === 0) {
        const current = await tx.get<RawApprovalRow>("SELECT * FROM approvals WHERE id = ?", [id]);
        return current ? toApprovalRow(current) : undefined;
      }

      const updated = await tx.get<RawApprovalRow>("SELECT * FROM approvals WHERE id = ?", [id]);
      return updated ? toApprovalRow(updated) : undefined;
    });
  }

  /** Get a single approval by id. */
  async getById(id: number): Promise<ApprovalRow | undefined> {
    const row = await this.db.get<RawApprovalRow>("SELECT * FROM approvals WHERE id = ?", [id]);

    return row ? toApprovalRow(row) : undefined;
  }

  /** Get all pending approvals, ordered by creation time (oldest first). */
  async getPending(): Promise<ApprovalRow[]> {
    return await this.getByStatus("pending");
  }

  /** Get approvals filtered by status, ordered by creation time (oldest first). */
  async getByStatus(status: ApprovalStatus): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      "SELECT * FROM approvals WHERE status = ? ORDER BY created_at ASC",
      [status],
    );

    return rows.map(toApprovalRow);
  }

  /** Get the most recent approval associated with a resume token. */
  async getByResumeToken(resumeToken: string): Promise<ApprovalRow | undefined> {
    const token = resumeToken.trim();
    if (!token) return undefined;
    const row = await this.db.get<RawApprovalRow>(
      "SELECT * FROM approvals WHERE resume_token = ? ORDER BY created_at DESC LIMIT 1",
      [token],
    );
    return row ? toApprovalRow(row) : undefined;
  }

  /** Get all approvals for a given plan. */
  async getByPlanId(planId: string): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      "SELECT * FROM approvals WHERE plan_id = ? ORDER BY step_index ASC",
      [planId],
    );

    return rows.map(toApprovalRow);
  }

  /**
   * Expire stale approvals whose `expires_at` has passed.
   * @returns the number of approvals expired.
   */
  async expireStale(): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE approvals
       SET status = 'expired', responded_at = ?
       WHERE status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= ?`,
      [nowIso, nowIso],
    );
    return result.changes;
  }

  /** Expire a single pending approval immediately. */
  async expireById(id: number): Promise<ApprovalRow | undefined> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE approvals
       SET status = 'expired', responded_at = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, id],
    );
    return await this.getById(id);
  }
}
