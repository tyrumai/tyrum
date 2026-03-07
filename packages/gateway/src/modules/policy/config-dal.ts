import { PolicyBundle } from "@tyrum/schemas";
import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type PolicyBundleScope =
  | { tenantId: string; scopeKind: "deployment" }
  | { tenantId: string; scopeKind: "agent"; agentId: string };

export type PolicyBundleConfigRevision = {
  revision: number;
  tenantId: string;
  scopeKind: "deployment" | "agent";
  agentId?: string;
  bundle: PolicyBundleT;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawPolicyBundleConfigRow {
  revision: number;
  tenant_id: string;
  scope_kind: "deployment" | "agent";
  agent_id: string | null;
  bundle_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseBundleOrThrow(row: RawPolicyBundleConfigRow): PolicyBundleT {
  const parsed = safeJsonParse(row.bundle_json, undefined as unknown);
  const bundle = PolicyBundle.safeParse(parsed);
  if (!bundle.success) {
    throw new Error(
      `policy bundle config revision ${String(row.revision)} failed schema validation: ${bundle.error.message}`,
    );
  }
  return bundle.data;
}

function rowToRevision(row: RawPolicyBundleConfigRow): PolicyBundleConfigRevision {
  return {
    revision: row.revision,
    tenantId: row.tenant_id,
    scopeKind: row.scope_kind,
    agentId: row.agent_id ?? undefined,
    bundle: parseBundleOrThrow(row),
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

function scopeWhere(scope: PolicyBundleScope): { sql: string; values: unknown[] } {
  if (scope.scopeKind === "deployment") {
    return {
      sql: "tenant_id = ? AND scope_kind = 'deployment' AND agent_id IS NULL",
      values: [scope.tenantId],
    };
  }
  return {
    sql: "tenant_id = ? AND scope_kind = 'agent' AND agent_id = ?",
    values: [scope.tenantId, scope.agentId],
  };
}

export class PolicyBundleConfigDal {
  constructor(private readonly db: SqlDb) {}

  async getLatest(scope: PolicyBundleScope): Promise<PolicyBundleConfigRevision | undefined> {
    const where = scopeWhere(scope);
    const row = await this.db.get<RawPolicyBundleConfigRow>(
      `SELECT revision, tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason, reverted_from_revision
       FROM policy_bundle_config_revisions
       WHERE ${where.sql}
       ORDER BY revision DESC
       LIMIT 1`,
      where.values,
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(
    scope: PolicyBundleScope,
    revision: number,
  ): Promise<PolicyBundleConfigRevision | undefined> {
    const where = scopeWhere(scope);
    const row = await this.db.get<RawPolicyBundleConfigRow>(
      `SELECT revision, tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason, reverted_from_revision
       FROM policy_bundle_config_revisions
       WHERE ${where.sql} AND revision = ?
       LIMIT 1`,
      [...where.values, revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async listRevisions(scope: PolicyBundleScope, limit = 50): Promise<PolicyBundleConfigRevision[]> {
    const where = scopeWhere(scope);
    const rows = await this.db.all<RawPolicyBundleConfigRow>(
      `SELECT revision, tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason, reverted_from_revision
       FROM policy_bundle_config_revisions
       WHERE ${where.sql}
       ORDER BY revision DESC
       LIMIT ?`,
      [...where.values, Math.max(1, Math.min(200, Math.floor(limit)))],
    );
    return rows.map(rowToRevision);
  }

  async set(params: {
    scope: PolicyBundleScope;
    bundle: PolicyBundleT;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<PolicyBundleConfigRevision> {
    const bundle = PolicyBundle.parse(params.bundle);
    const row = await this.db.get<RawPolicyBundleConfigRow>(
      `INSERT INTO policy_bundle_config_revisions (
         tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason, reverted_from_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING revision, tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason, reverted_from_revision`,
      [
        params.scope.tenantId,
        params.scope.scopeKind,
        params.scope.scopeKind === "agent" ? params.scope.agentId : null,
        JSON.stringify(bundle),
        params.occurredAtIso ?? new Date().toISOString(),
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) throw new Error("policy bundle config insert failed");
    return rowToRevision(row);
  }

  async revertToRevision(params: {
    scope: PolicyBundleScope;
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<PolicyBundleConfigRevision> {
    const target = await this.getByRevision(params.scope, params.revision);
    if (!target) {
      throw new Error(`policy bundle config revision ${String(params.revision)} not found`);
    }
    return await this.set({
      scope: params.scope,
      bundle: target.bundle,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }
}
