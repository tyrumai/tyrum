import { createHash } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type RuntimePackageKind = "skill" | "mcp" | "plugin";

export type RuntimePackageRevision = {
  revision: number;
  tenantId: string;
  packageKind: RuntimePackageKind;
  packageKey: string;
  packageData: unknown;
  artifactId?: string;
  enabled: boolean;
  packageSha256: string;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawRuntimePackageRow {
  revision: number;
  tenant_id: string;
  package_kind: RuntimePackageKind;
  package_key: string;
  package_json: string;
  artifact_id: string | null;
  enabled: number;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function rowToRevision(row: RawRuntimePackageRow): RuntimePackageRevision {
  const packageData = safeJsonParse(row.package_json, undefined as unknown);
  if (packageData === undefined) {
    throw new Error(`runtime package revision ${String(row.revision)} has invalid JSON`);
  }

  return {
    revision: row.revision,
    tenantId: row.tenant_id,
    packageKind: row.package_kind,
    packageKey: row.package_key,
    packageData,
    artifactId: row.artifact_id ?? undefined,
    enabled: row.enabled === 1,
    packageSha256: createHash("sha256")
      .update(row.package_json)
      .update("\n")
      .update(row.artifact_id ?? "")
      .update("\n")
      .update(String(row.enabled))
      .digest("hex"),
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

function normalizeKind(kind: string): RuntimePackageKind {
  if (kind === "skill" || kind === "mcp" || kind === "plugin") return kind;
  throw new Error(`unsupported runtime package kind '${kind}'`);
}

export class RuntimePackageDal {
  constructor(private readonly db: SqlDb) {}

  async listLatest(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKeys?: readonly string[];
    enabledOnly?: boolean;
  }): Promise<RuntimePackageRevision[]> {
    const keyFilter = (params.packageKeys ?? []).map((value) => value.trim()).filter(Boolean);
    const values: unknown[] = [params.tenantId, normalizeKind(params.packageKind)];
    const clauses = ["tenant_id = ?", "package_kind = ?"];

    if (keyFilter.length > 0) {
      clauses.push(`package_key IN (${keyFilter.map(() => "?").join(", ")})`);
      values.push(...keyFilter);
    }
    if (params.enabledOnly) {
      clauses.push("enabled = 1");
    }

    const rows = await this.db.all<RawRuntimePackageRow>(
      `SELECT revision, tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason, reverted_from_revision
       FROM runtime_package_revisions current
       WHERE ${clauses.join(" AND ")}
         AND revision = (
           SELECT MAX(inner_pkg.revision)
           FROM runtime_package_revisions inner_pkg
           WHERE inner_pkg.tenant_id = current.tenant_id
             AND inner_pkg.package_kind = current.package_kind
             AND inner_pkg.package_key = current.package_key
         )
       ORDER BY package_key ASC`,
      values,
    );
    return rows.map(rowToRevision);
  }

  async getLatest(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKey: string;
  }): Promise<RuntimePackageRevision | undefined> {
    const rows = await this.listLatest({
      tenantId: params.tenantId,
      packageKind: params.packageKind,
      packageKeys: [params.packageKey],
    });
    return rows[0];
  }

  async getByRevision(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKey: string;
    revision: number;
  }): Promise<RuntimePackageRevision | undefined> {
    const row = await this.db.get<RawRuntimePackageRow>(
      `SELECT revision, tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason, reverted_from_revision
       FROM runtime_package_revisions
       WHERE tenant_id = ? AND package_kind = ? AND package_key = ? AND revision = ?
       LIMIT 1`,
      [params.tenantId, params.packageKind, params.packageKey, params.revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async listRevisions(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKey: string;
    limit?: number;
  }): Promise<RuntimePackageRevision[]> {
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(200, Math.floor(params.limit)))
        : 50;

    const rows = await this.db.all<RawRuntimePackageRow>(
      `SELECT revision, tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason, reverted_from_revision
       FROM runtime_package_revisions
       WHERE tenant_id = ? AND package_kind = ? AND package_key = ?
       ORDER BY revision DESC
       LIMIT ?`,
      [params.tenantId, params.packageKind, params.packageKey, limit],
    );
    return rows.map(rowToRevision);
  }

  async set(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKey: string;
    packageData: unknown;
    artifactId?: string;
    enabled?: boolean;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<RuntimePackageRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const row = await this.db.get<RawRuntimePackageRow>(
      `INSERT INTO runtime_package_revisions (
         tenant_id,
         package_kind,
         package_key,
         package_json,
         artifact_id,
         enabled,
         created_at,
         created_by_json,
         reason,
         reverted_from_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING revision, tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason, reverted_from_revision`,
      [
        params.tenantId,
        normalizeKind(params.packageKind),
        params.packageKey.trim(),
        JSON.stringify(params.packageData ?? {}),
        params.artifactId ?? null,
        params.enabled === false ? 0 : 1,
        createdAt,
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) {
      throw new Error("runtime package insert failed");
    }
    return rowToRevision(row);
  }

  async revertToRevision(params: {
    tenantId: string;
    packageKind: RuntimePackageKind;
    packageKey: string;
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<RuntimePackageRevision> {
    const target = await this.getByRevision(params);
    if (!target) {
      throw new Error(`runtime package revision ${String(params.revision)} not found`);
    }

    return await this.set({
      tenantId: params.tenantId,
      packageKind: params.packageKind,
      packageKey: params.packageKey,
      packageData: target.packageData,
      artifactId: target.artifactId,
      enabled: target.enabled,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }
}
