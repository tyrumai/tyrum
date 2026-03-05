import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { coerceRecord } from "../util/coerce.js";
import type { ApprovalRow } from "./dal.js";

export type ApprovalEngineActionKind = "resume_run" | "cancel_run";
export type ApprovalEngineActionStatus = "queued" | "processing" | "succeeded" | "failed";

export interface ApprovalEngineActionRow {
  tenant_id: string;
  action_id: string;
  approval_id: string;
  action_kind: ApprovalEngineActionKind;
  resume_token: string | null;
  run_id: string | null;
  reason: string | null;
  status: ApprovalEngineActionStatus;
  attempts: number;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

interface RawApprovalEngineActionRow {
  tenant_id: string;
  action_id: string;
  approval_id: string;
  action_kind: string;
  resume_token: string | null;
  run_id: string | null;
  reason: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  processed_at: string | Date | null;
}

function toRow(raw: RawApprovalEngineActionRow): ApprovalEngineActionRow {
  return {
    tenant_id: raw.tenant_id,
    action_id: raw.action_id,
    approval_id: raw.approval_id,
    action_kind: raw.action_kind as ApprovalEngineActionKind,
    resume_token: raw.resume_token,
    run_id: raw.run_id,
    reason: raw.reason,
    status: raw.status as ApprovalEngineActionStatus,
    attempts: raw.attempts,
    last_error: raw.last_error,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    created_at: normalizeDbDateTime(raw.created_at) ?? new Date().toISOString(),
    updated_at: normalizeDbDateTime(raw.updated_at) ?? new Date().toISOString(),
    processed_at: normalizeDbDateTime(raw.processed_at),
  };
}

function isAgentToolExecutionContext(value: unknown): boolean {
  const record = coerceRecord(value);
  return record?.["source"] === "agent-tool-execution";
}

function resolveActionFromResolvedApproval(
  approval: ApprovalRow,
  reason: string | undefined,
):
  | { actionKind: "resume_run"; resumeToken: string }
  | { actionKind: "cancel_run"; runId: string; reason: string }
  | undefined {
  const resumeToken = approval.resume_token?.trim();
  const runId = approval.run_id?.trim();
  const resolvedReason = reason?.trim() || "approval denied";
  const approvedMissingResumeReason =
    reason?.trim() || "approval approved but missing resume token";

  if (approval.status === "approved") {
    if (resumeToken) {
      return { actionKind: "resume_run", resumeToken };
    }
    return runId
      ? { actionKind: "cancel_run", runId, reason: approvedMissingResumeReason }
      : undefined;
  }

  if (approval.status === "denied") {
    if (resumeToken && isAgentToolExecutionContext(approval.context)) {
      return { actionKind: "resume_run", resumeToken };
    }
    return runId ? { actionKind: "cancel_run", runId, reason: resolvedReason } : undefined;
  }

  return undefined;
}

export class ApprovalEngineActionDal {
  constructor(private readonly db: SqlDb) {}

  async getByApprovalIdAndKind(input: {
    tenantId: string;
    approvalId: string;
    actionKind: ApprovalEngineActionKind;
  }): Promise<ApprovalEngineActionRow | undefined> {
    const row = await this.db.get<RawApprovalEngineActionRow>(
      `SELECT *
       FROM approval_engine_actions
       WHERE tenant_id = ? AND approval_id = ? AND action_kind = ?`,
      [input.tenantId, input.approvalId, input.actionKind],
    );
    return row ? toRow(row) : undefined;
  }

  async enqueueForResolvedApproval(input: {
    tenantId: string;
    approval: ApprovalRow;
    reason?: string;
  }): Promise<{ row: ApprovalEngineActionRow; deduped: boolean } | undefined> {
    const action = resolveActionFromResolvedApproval(input.approval, input.reason);
    if (!action) return undefined;

    const inserted = await this.db.get<RawApprovalEngineActionRow>(
      `INSERT INTO approval_engine_actions (
         tenant_id,
         action_id,
         approval_id,
         action_kind,
         resume_token,
         run_id,
         reason
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, approval_id, action_kind) DO NOTHING
       RETURNING *`,
      [
        input.tenantId,
        randomUUID(),
        input.approval.approval_id,
        action.actionKind,
        action.actionKind === "resume_run" ? action.resumeToken : null,
        action.actionKind === "cancel_run" ? action.runId : null,
        action.actionKind === "cancel_run" ? action.reason : null,
      ],
    );
    if (inserted) return { row: toRow(inserted), deduped: false };

    const existing = await this.getByApprovalIdAndKind({
      tenantId: input.tenantId,
      approvalId: input.approval.approval_id,
      actionKind: action.actionKind,
    });
    if (!existing) {
      throw new Error("failed to enqueue approval engine action");
    }
    return { row: existing, deduped: true };
  }

  async claimNext(input: {
    tenantId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    leaseTtlMs: number;
    maxAttempts: number;
  }): Promise<ApprovalEngineActionRow | undefined> {
    const leaseExpiresAtMs = input.nowMs + Math.max(1, input.leaseTtlMs);

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawApprovalEngineActionRow>(
        `SELECT *
         FROM approval_engine_actions
         WHERE tenant_id = ?
           AND attempts < ?
           AND (
             status = 'queued'
             OR (
               status = 'processing'
               AND lease_expires_at_ms IS NOT NULL
               AND lease_expires_at_ms <= ?
             )
           )
         ORDER BY updated_at ASC, action_id ASC
         LIMIT 1`,
        [input.tenantId, input.maxAttempts, input.nowMs],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE approval_engine_actions
         SET status = 'processing',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempts = attempts + 1,
             updated_at = ?
         WHERE tenant_id = ?
           AND action_id = ?
           AND attempts < ?
           AND (
             status = 'queued'
             OR (
               status = 'processing'
               AND lease_expires_at_ms IS NOT NULL
               AND lease_expires_at_ms <= ?
             )
           )`,
        [
          input.owner,
          leaseExpiresAtMs,
          input.nowIso,
          input.tenantId,
          candidate.action_id,
          input.maxAttempts,
          input.nowMs,
        ],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawApprovalEngineActionRow>(
        `SELECT *
         FROM approval_engine_actions
         WHERE tenant_id = ? AND action_id = ?`,
        [input.tenantId, candidate.action_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async markSucceeded(input: {
    tenantId: string;
    actionId: string;
    owner: string;
    nowIso: string;
  }): Promise<boolean> {
    const res = await this.db.run(
      `UPDATE approval_engine_actions
       SET status = 'succeeded',
           last_error = NULL,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = COALESCE(processed_at, ?),
           updated_at = ?
       WHERE tenant_id = ?
         AND action_id = ?
         AND status = 'processing'
         AND lease_owner = ?`,
      [input.nowIso, input.nowIso, input.tenantId, input.actionId, input.owner],
    );
    return res.changes === 1;
  }

  async requeueWithError(input: {
    tenantId: string;
    actionId: string;
    owner: string;
    nowIso: string;
    error: string;
  }): Promise<boolean> {
    const message = input.error.trim().slice(0, 10_000);
    const res = await this.db.run(
      `UPDATE approval_engine_actions
       SET status = 'queued',
           last_error = ?,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND action_id = ?
         AND status = 'processing'
         AND lease_owner = ?`,
      [message, input.nowIso, input.tenantId, input.actionId, input.owner],
    );
    return res.changes === 1;
  }

  async markFailed(input: {
    tenantId: string;
    actionId: string;
    owner: string;
    nowIso: string;
    error: string;
  }): Promise<boolean> {
    const message = input.error.trim().slice(0, 10_000);
    const res = await this.db.run(
      `UPDATE approval_engine_actions
       SET status = 'failed',
           last_error = ?,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = COALESCE(processed_at, ?),
           updated_at = ?
       WHERE tenant_id = ?
         AND action_id = ?
         AND status = 'processing'
         AND lease_owner = ?`,
      [message, input.nowIso, input.nowIso, input.tenantId, input.actionId, input.owner],
    );
    return res.changes === 1;
  }
}
