import type { SqlDb } from "../../statestore/types.js";

export type PolicyOverrideStatus = "active" | "revoked" | "expired";

export interface PolicyOverrideRow {
  policy_override_id: string;
  status: PolicyOverrideStatus;
  created_at: string;
  created_by: unknown;
  agent_id: string;
  workspace_id: string | null;
  tool_id: string;
  pattern: string;
  created_from_approval_id: number | null;
  created_from_policy_snapshot_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: unknown;
  revoked_reason: string | null;
}

interface RawPolicyOverrideRow {
  policy_override_id: string;
  status: string;
  created_at: string | Date;
  created_by_json: string | null;
  agent_id: string;
  workspace_id: string | null;
  tool_id: string;
  pattern: string;
  created_from_approval_id: number | null;
  created_from_policy_snapshot_id: string | null;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  revoked_by_json: string | null;
  revoked_reason: string | null;
}

function normalizeTime(value: string | Date): string {
  const raw = value instanceof Date ? value.toISOString() : value;
  if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(raw)) {
    return `${raw.replace(" ", "T")}Z`;
  }
  return raw;
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function toRow(raw: RawPolicyOverrideRow): PolicyOverrideRow {
  return {
    policy_override_id: raw.policy_override_id,
    status: raw.status as PolicyOverrideStatus,
    created_at: normalizeTime(raw.created_at),
    created_by: parseJson(raw.created_by_json),
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    tool_id: raw.tool_id,
    pattern: raw.pattern,
    created_from_approval_id: raw.created_from_approval_id,
    created_from_policy_snapshot_id: raw.created_from_policy_snapshot_id,
    expires_at: raw.expires_at ? normalizeTime(raw.expires_at) : null,
    revoked_at: raw.revoked_at ? normalizeTime(raw.revoked_at) : null,
    revoked_by: parseJson(raw.revoked_by_json),
    revoked_reason: raw.revoked_reason,
  };
}

export interface CreatePolicyOverrideParams {
  policyOverrideId: string;
  agentId: string;
  workspaceId?: string | null;
  toolId: string;
  pattern: string;
  createdAt?: string;
  createdBy?: unknown;
  createdFromApprovalId?: number;
  createdFromPolicySnapshotId?: string;
  expiresAt?: string;
}

export class PolicyOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async create(params: CreatePolicyOverrideParams): Promise<PolicyOverrideRow> {
    const nowIso = params.createdAt ?? new Date().toISOString();
    const row = await this.db.get<RawPolicyOverrideRow>(
      `INSERT INTO policy_overrides (
         policy_override_id,
         status,
         created_at,
         created_by_json,
         agent_id,
         workspace_id,
         tool_id,
         pattern,
         created_from_approval_id,
         created_from_policy_snapshot_id,
         expires_at
       ) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.policyOverrideId,
        nowIso,
        params.createdBy ? JSON.stringify(params.createdBy) : null,
        params.agentId,
        params.workspaceId ?? null,
        params.toolId,
        params.pattern,
        params.createdFromApprovalId ?? null,
        params.createdFromPolicySnapshotId ?? null,
        params.expiresAt ?? null,
      ],
    );
    if (!row) throw new Error("policy override insert failed");
    return toRow(row);
  }

  async getById(id: string): Promise<PolicyOverrideRow | undefined> {
    const row = await this.db.get<RawPolicyOverrideRow>(
      "SELECT * FROM policy_overrides WHERE policy_override_id = ?",
      [id],
    );
    return row ? toRow(row) : undefined;
  }

  async list(opts?: {
    agentId?: string;
    toolId?: string;
    status?: PolicyOverrideStatus;
    limit?: number;
  }): Promise<PolicyOverrideRow[]> {
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    const params: unknown[] = [];

    let sql = "SELECT * FROM policy_overrides WHERE 1=1";
    if (opts?.agentId) {
      sql += " AND agent_id = ?";
      params.push(opts.agentId);
    }
    if (opts?.toolId) {
      sql += " AND tool_id = ?";
      params.push(opts.toolId);
    }
    if (opts?.status) {
      sql += " AND status = ?";
      params.push(opts.status);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = await this.db.all<RawPolicyOverrideRow>(sql, params);
    return rows.map(toRow);
  }

  async listActiveForTool(opts: {
    agentId: string;
    workspaceId?: string | null;
    toolId: string;
  }): Promise<PolicyOverrideRow[]> {
    const nowIso = new Date().toISOString();
    const rows = await this.db.all<RawPolicyOverrideRow>(
      `SELECT *
       FROM policy_overrides
       WHERE status = 'active'
         AND agent_id = ?
         AND tool_id = ?
         AND (workspace_id IS NULL OR workspace_id = ?)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
      [opts.agentId, opts.toolId, opts.workspaceId ?? null, nowIso],
    );
    return rows.map(toRow);
  }

  async revoke(params: {
    policyOverrideId: string;
    revokedBy?: unknown;
    revokedReason?: string;
  }): Promise<PolicyOverrideRow | undefined> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<RawPolicyOverrideRow>(
      `UPDATE policy_overrides
       SET status = 'revoked',
           revoked_at = ?,
           revoked_by_json = ?,
           revoked_reason = ?
       WHERE policy_override_id = ? AND status = 'active'
       RETURNING *`,
      [
        nowIso,
        params.revokedBy ? JSON.stringify(params.revokedBy) : null,
        params.revokedReason ?? null,
        params.policyOverrideId,
      ],
    );
    if (row) return toRow(row);
    return await this.getById(params.policyOverrideId);
  }

  async expireStale(): Promise<PolicyOverrideRow[]> {
    const nowIso = new Date().toISOString();
    const rows = await this.db.all<RawPolicyOverrideRow>(
      `UPDATE policy_overrides
       SET status = 'expired'
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at <= ?
       RETURNING *`,
      [nowIso],
    );
    return rows.map(toRow);
  }
}

