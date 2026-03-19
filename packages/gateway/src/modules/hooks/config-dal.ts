import { LifecycleHooksConfig } from "@tyrum/contracts";
import type { LifecycleHookDefinition as LifecycleHookDefinitionT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type LifecycleHookConfigRevision = {
  revision: number;
  tenantId: string;
  hooks: LifecycleHookDefinitionT[];
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawLifecycleHookConfigRow {
  revision: number;
  tenant_id: string;
  hooks_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseHooksOrThrow(row: RawLifecycleHookConfigRow): LifecycleHookDefinitionT[] {
  const parsed = safeJsonParse(row.hooks_json, undefined as unknown);
  const config = LifecycleHooksConfig.safeParse({ v: 1, hooks: parsed });
  if (!config.success) {
    throw new Error(
      `lifecycle hook revision ${String(row.revision)} failed schema validation: ${config.error.message}`,
    );
  }
  return config.data.hooks;
}

function rowToRevision(row: RawLifecycleHookConfigRow): LifecycleHookConfigRevision {
  return {
    revision: row.revision,
    tenantId: row.tenant_id,
    hooks: parseHooksOrThrow(row),
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

export class LifecycleHookConfigDal {
  constructor(private readonly db: SqlDb) {}

  async getLatest(tenantId: string): Promise<LifecycleHookConfigRevision | undefined> {
    const row = await this.db.get<RawLifecycleHookConfigRow>(
      `SELECT revision, tenant_id, hooks_json, created_at, created_by_json, reason, reverted_from_revision
       FROM lifecycle_hook_configs
       WHERE tenant_id = ?
       ORDER BY revision DESC
       LIMIT 1`,
      [tenantId],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(
    tenantId: string,
    revision: number,
  ): Promise<LifecycleHookConfigRevision | undefined> {
    const row = await this.db.get<RawLifecycleHookConfigRow>(
      `SELECT revision, tenant_id, hooks_json, created_at, created_by_json, reason, reverted_from_revision
       FROM lifecycle_hook_configs
       WHERE tenant_id = ? AND revision = ?
       LIMIT 1`,
      [tenantId, revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async listRevisions(tenantId: string, limit = 50): Promise<LifecycleHookConfigRevision[]> {
    const rows = await this.db.all<RawLifecycleHookConfigRow>(
      `SELECT revision, tenant_id, hooks_json, created_at, created_by_json, reason, reverted_from_revision
       FROM lifecycle_hook_configs
       WHERE tenant_id = ?
       ORDER BY revision DESC
       LIMIT ?`,
      [tenantId, Math.max(1, Math.min(200, Math.floor(limit)))],
    );
    return rows.map(rowToRevision);
  }

  async set(params: {
    tenantId: string;
    hooks: LifecycleHookDefinitionT[];
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<LifecycleHookConfigRevision> {
    const hooks = LifecycleHooksConfig.parse({ v: 1, hooks: params.hooks }).hooks;
    const row = await this.db.get<RawLifecycleHookConfigRow>(
      `INSERT INTO lifecycle_hook_configs (
         tenant_id, hooks_json, created_at, created_by_json, reason, reverted_from_revision
       ) VALUES (?, ?, ?, ?, ?, ?)
       RETURNING revision, tenant_id, hooks_json, created_at, created_by_json, reason, reverted_from_revision`,
      [
        params.tenantId,
        JSON.stringify(hooks),
        params.occurredAtIso ?? new Date().toISOString(),
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) throw new Error("lifecycle hook config insert failed");
    return rowToRevision(row);
  }

  async revertToRevision(params: {
    tenantId: string;
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<LifecycleHookConfigRevision> {
    const target = await this.getByRevision(params.tenantId, params.revision);
    if (!target) {
      throw new Error(`lifecycle hook config revision ${String(params.revision)} not found`);
    }
    return await this.set({
      tenantId: params.tenantId,
      hooks: target.hooks,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }
}
