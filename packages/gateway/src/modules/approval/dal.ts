/**
 * Approval queue data access layer.
 *
 * Persists human approval requests to the gateway DB so they survive restarts
 * and can be resolved by the operator UI / WS protocol.
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalRow {
  tenant_id: string;
  approval_id: string;
  approval_key: string;
  agent_id: string;
  workspace_id: string;
  kind: string;
  status: ApprovalStatus;
  prompt: string;
  context: unknown;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  resolution: unknown | null;

  session_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  work_item_id: string | null;
  work_item_task_id: string | null;
  resume_token: string | null;
}

interface RawApprovalRow {
  tenant_id: string;
  approval_id: string;
  approval_key: string;
  agent_id: string;
  workspace_id: string;
  kind: string;
  status: string;
  prompt: string;
  context_json: string;
  created_at: string | Date;
  expires_at: string | Date | null;
  resolved_at: string | Date | null;
  resolution_json: string | null;

  session_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  work_item_id: string | null;
  work_item_task_id: string | null;
  resume_token: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOrEmpty(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: tolerate invalid JSON in persisted rows.
    return {};
  }
}

function parseJsonOrNull(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: tolerate invalid JSON in persisted rows.
    return null;
  }
}

function normalizeStatus(raw: string): ApprovalStatus {
  if (
    raw === "pending" ||
    raw === "approved" ||
    raw === "denied" ||
    raw === "expired" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "pending";
}

function toApprovalRow(raw: RawApprovalRow): ApprovalRow {
  return {
    tenant_id: raw.tenant_id,
    approval_id: raw.approval_id,
    approval_key: raw.approval_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    kind: raw.kind,
    status: normalizeStatus(raw.status),
    prompt: raw.prompt,
    context: parseJsonOrEmpty(raw.context_json),
    created_at: normalizeTime(raw.created_at),
    expires_at: normalizeMaybeTime(raw.expires_at),
    resolved_at: normalizeMaybeTime(raw.resolved_at),
    resolution: parseJsonOrNull(raw.resolution_json),
    session_id: raw.session_id,
    plan_id: raw.plan_id,
    run_id: raw.run_id,
    step_id: raw.step_id,
    attempt_id: raw.attempt_id,
    work_item_id: raw.work_item_id,
    work_item_task_id: raw.work_item_task_id,
    resume_token: raw.resume_token,
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

export interface CreateApprovalParams {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  approvalKey: string;
  prompt: string;
  kind?: string;
  context?: unknown;
  expiresAt?: string | null;

  sessionId?: string | null;
  planId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
  workItemId?: string | null;
  workItemTaskId?: string | null;
  resumeToken?: string | null;
}

export class ApprovalDal {
  constructor(private readonly db: SqlDb) {}

  /** Create a new pending approval request (idempotent on `approval_key`). */
  async create(params: CreateApprovalParams): Promise<ApprovalRow> {
    const tenantId = params.tenantId.trim();
    const agentId = params.agentId.trim();
    const workspaceId = params.workspaceId.trim();
    if (!tenantId) throw new Error("tenantId is required");
    if (!agentId) throw new Error("agentId is required");
    if (!workspaceId) throw new Error("workspaceId is required");

    const approvalKey = params.approvalKey.trim();
    if (!approvalKey) throw new Error("approvalKey is required");

    const nowIso = isoNow();
    const contextJson = JSON.stringify(params.context ?? {});
    const kind = params.kind?.trim() || "other";

    const inserted = await this.db.get<RawApprovalRow>(
      `INSERT INTO approvals (
         tenant_id,
         approval_id,
         approval_key,
         agent_id,
         workspace_id,
         kind,
	         status,
	         prompt,
	         context_json,
	         created_at,
	         expires_at,
	         session_id,
	         plan_id,
	         run_id,
         step_id,
         attempt_id,
         work_item_id,
	         work_item_task_id,
	         resume_token
	       )
		       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	       ON CONFLICT (tenant_id, approval_key) DO NOTHING
	       RETURNING *`,
      [
        tenantId,
        randomUUID(),
        approvalKey,
        agentId,
        workspaceId,
        kind,
        params.prompt,
        contextJson,
        nowIso,
        params.expiresAt ?? null,
        params.sessionId ?? null,
        params.planId ?? null,
        params.runId ?? null,
        params.stepId ?? null,
        params.attemptId ?? null,
        params.workItemId ?? null,
        params.workItemTaskId ?? null,
        params.resumeToken ?? null,
      ],
    );
    if (inserted) return toApprovalRow(inserted);

    const existing = await this.getByKey({ tenantId, approvalKey });
    if (!existing) {
      throw new Error("failed to create approval");
    }
    return existing;
  }

  async getById(input: { tenantId: string; approvalId: string }): Promise<ApprovalRow | undefined> {
    const row = await this.db.get<RawApprovalRow>(
      "SELECT * FROM approvals WHERE tenant_id = ? AND approval_id = ?",
      [input.tenantId, input.approvalId],
    );
    return row ? toApprovalRow(row) : undefined;
  }

  async getByKey(input: {
    tenantId: string;
    approvalKey: string;
  }): Promise<ApprovalRow | undefined> {
    const row = await this.db.get<RawApprovalRow>(
      "SELECT * FROM approvals WHERE tenant_id = ? AND approval_key = ?",
      [input.tenantId, input.approvalKey],
    );
    return row ? toApprovalRow(row) : undefined;
  }

  async getByStatus(input: { tenantId: string; status: ApprovalStatus }): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      "SELECT * FROM approvals WHERE tenant_id = ? AND status = ? ORDER BY created_at ASC, approval_id ASC",
      [input.tenantId, input.status],
    );
    return rows.map(toApprovalRow);
  }

  async getPending(input: { tenantId: string }): Promise<ApprovalRow[]> {
    return await this.getByStatus({ tenantId: input.tenantId, status: "pending" });
  }

  async getByResumeToken(input: {
    tenantId: string;
    resumeToken: string;
  }): Promise<ApprovalRow | undefined> {
    const token = input.resumeToken.trim();
    if (!token) return undefined;
    const row = await this.db.get<RawApprovalRow>(
      "SELECT * FROM approvals WHERE tenant_id = ? AND resume_token = ? ORDER BY created_at DESC LIMIT 1",
      [input.tenantId, token],
    );
    return row ? toApprovalRow(row) : undefined;
  }

  async respond(input: {
    tenantId: string;
    approvalId: string;
    decision: "approved" | "denied";
    reason?: string;
    resolvedBy?: unknown;
  }): Promise<ApprovalRow | undefined> {
    const nowIso = isoNow();
    const resolution = {
      decision: input.decision,
      resolved_at: nowIso,
      resolved_by: input.resolvedBy,
      reason: input.reason?.trim() || undefined,
    };
    const resolutionJson = JSON.stringify(resolution);

    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<RawApprovalRow>(
        "SELECT * FROM approvals WHERE tenant_id = ? AND approval_id = ?",
        [input.tenantId, input.approvalId],
      );
      if (!existing) return undefined;

      if (existing.status !== "pending") {
        return toApprovalRow(existing);
      }

      const status: ApprovalStatus = input.decision === "approved" ? "approved" : "denied";
      const result = await tx.run(
        `UPDATE approvals
         SET status = ?, resolved_at = ?, resolution_json = ?
         WHERE tenant_id = ? AND approval_id = ? AND status = 'pending'`,
        [status, nowIso, resolutionJson, input.tenantId, input.approvalId],
      );

      if (result.changes === 0) {
        const current = await tx.get<RawApprovalRow>(
          "SELECT * FROM approvals WHERE tenant_id = ? AND approval_id = ?",
          [input.tenantId, input.approvalId],
        );
        return current ? toApprovalRow(current) : undefined;
      }

      const updated = await tx.get<RawApprovalRow>(
        "SELECT * FROM approvals WHERE tenant_id = ? AND approval_id = ?",
        [input.tenantId, input.approvalId],
      );
      return updated ? toApprovalRow(updated) : undefined;
    });
  }

  /**
   * Expire stale approvals whose `expires_at` has passed.
   * @returns the number of approvals expired.
   */
  async expireStale(input: { tenantId: string; nowIso?: string }): Promise<number> {
    const nowIso = input.nowIso ?? isoNow();
    const resolutionJson = JSON.stringify({
      decision: "denied",
      resolved_at: nowIso,
      reason: "expired",
    });
    const result = await this.db.run(
      `UPDATE approvals
       SET status = 'expired', resolved_at = ?, resolution_json = ?
       WHERE tenant_id = ?
         AND status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= ?`,
      [nowIso, resolutionJson, input.tenantId, nowIso],
    );
    return result.changes;
  }

  /** Expire a single pending approval immediately. */
  async expireById(input: {
    tenantId: string;
    approvalId: string;
    nowIso?: string;
  }): Promise<ApprovalRow | undefined> {
    const nowIso = input.nowIso ?? isoNow();
    const resolutionJson = JSON.stringify({
      decision: "denied",
      resolved_at: nowIso,
      reason: "expired",
    });
    await this.db.run(
      `UPDATE approvals
       SET status = 'expired', resolved_at = ?, resolution_json = ?
       WHERE tenant_id = ? AND approval_id = ? AND status = 'pending'`,
      [nowIso, resolutionJson, input.tenantId, input.approvalId],
    );
    return await this.getById({ tenantId: input.tenantId, approvalId: input.approvalId });
  }
}
