import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface PolicyOverrideRow {
  policy_override_id: string;
  status: "active" | "revoked" | "expired";
  agent_id: string;
  workspace_id: string | null;
  tool_id: string;
  pattern: string;
  created_at: string;
  created_by: string | null;
  created_from_approval_id: number | null;
  created_from_policy_snapshot_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

interface RawOverrideRow {
  policy_override_id: string;
  status: string;
  agent_id: string;
  workspace_id: string | null;
  tool_id: string;
  pattern: string;
  created_at: string | Date;
  created_by: string | null;
  created_from_approval_id: number | null;
  created_from_policy_snapshot_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawOverrideRow): PolicyOverrideRow {
  return {
    ...raw,
    status: raw.status as PolicyOverrideRow["status"],
    created_at: normalizeTime(raw.created_at),
  };
}

export class PolicyOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async create(params: {
    agentId: string;
    toolId: string;
    pattern: string;
    workspaceId?: string;
    createdBy?: string;
    approvalId?: number;
    policySnapshotId?: string;
    expiresAt?: string;
  }): Promise<PolicyOverrideRow> {
    const id = randomUUID();
    const row = await this.db.get<RawOverrideRow>(
      `INSERT INTO policy_overrides
         (policy_override_id, agent_id, tool_id, pattern, workspace_id,
          created_by, created_from_approval_id, created_from_policy_snapshot_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        params.agentId,
        params.toolId,
        params.pattern,
        params.workspaceId ?? null,
        params.createdBy ?? null,
        params.approvalId ?? null,
        params.policySnapshotId ?? null,
        params.expiresAt ?? null,
      ],
    );
    if (!row) throw new Error("policy override insert failed");
    return toRow(row);
  }

  async getById(overrideId: string): Promise<PolicyOverrideRow | undefined> {
    const row = await this.db.get<RawOverrideRow>(
      "SELECT * FROM policy_overrides WHERE policy_override_id = ?",
      [overrideId],
    );
    return row ? toRow(row) : undefined;
  }

  /** List active overrides for a given agent and tool. */
  async listActive(agentId: string, toolId?: string): Promise<PolicyOverrideRow[]> {
    if (toolId) {
      const rows = await this.db.all<RawOverrideRow>(
        `SELECT * FROM policy_overrides
         WHERE agent_id = ? AND tool_id = ? AND status = 'active'
         ORDER BY created_at DESC`,
        [agentId, toolId],
      );
      return rows.map(toRow);
    }
    const rows = await this.db.all<RawOverrideRow>(
      `SELECT * FROM policy_overrides
       WHERE agent_id = ? AND status = 'active'
       ORDER BY created_at DESC`,
      [agentId],
    );
    return rows.map(toRow);
  }

  async revoke(overrideId: string, revokedBy?: string, reason?: string): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE policy_overrides
       SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoked_reason = ?
       WHERE policy_override_id = ? AND status = 'active'`,
      [new Date().toISOString(), revokedBy ?? null, reason ?? null, overrideId],
    );
    return result.changes > 0;
  }

  /** Expire overrides past their expires_at. */
  async expireStale(): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE policy_overrides
       SET status = 'expired'
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
      [nowIso],
    );
    return result.changes;
  }

  async listAll(agentId?: string): Promise<PolicyOverrideRow[]> {
    if (agentId) {
      const rows = await this.db.all<RawOverrideRow>(
        "SELECT * FROM policy_overrides WHERE agent_id = ? ORDER BY created_at DESC",
        [agentId],
      );
      return rows.map(toRow);
    }
    const rows = await this.db.all<RawOverrideRow>(
      "SELECT * FROM policy_overrides ORDER BY created_at DESC",
      [],
    );
    return rows.map(toRow);
  }
}
