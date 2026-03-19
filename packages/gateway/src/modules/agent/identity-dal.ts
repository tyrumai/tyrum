import { createHash } from "node:crypto";
import { IdentityPack as IdentityPackSchema } from "@tyrum/contracts";
import type { IdentityPack as IdentityPackT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type AgentIdentityRevision = {
  revision: number;
  tenantId: string;
  agentId: string;
  identity: IdentityPackT;
  identitySha256: string;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawAgentIdentityRow {
  revision: number;
  tenant_id: string;
  agent_id: string;
  identity_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseIdentityOrThrow(row: RawAgentIdentityRow): IdentityPackT {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.identity_json) as unknown;
  } catch (err) {
    throw new Error(`agent identity revision ${String(row.revision)} has invalid JSON`, {
      cause: err,
    });
  }

  const identity = IdentityPackSchema.safeParse(parsed);
  if (!identity.success) {
    throw new Error(
      `agent identity revision ${String(row.revision)} failed schema validation: ${identity.error.message}`,
    );
  }

  return identity.data;
}

function rowToRevision(row: RawAgentIdentityRow): AgentIdentityRevision {
  return {
    revision: row.revision,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    identity: parseIdentityOrThrow(row),
    identitySha256: createHash("sha256").update(row.identity_json).digest("hex"),
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

export class AgentIdentityDal {
  constructor(private readonly db: SqlDb) {}

  async listRevisions(params: {
    tenantId: string;
    agentId: string;
    limit?: number;
  }): Promise<AgentIdentityRevision[]> {
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(200, Math.floor(params.limit)))
        : 50;

    const rows = await this.db.all<RawAgentIdentityRow>(
      `SELECT revision, tenant_id, agent_id, identity_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_identity_revisions
       WHERE tenant_id = ? AND agent_id = ?
       ORDER BY revision DESC
       LIMIT ?`,
      [params.tenantId, params.agentId, limit],
    );
    return rows.map(rowToRevision);
  }

  async getLatest(params: {
    tenantId: string;
    agentId: string;
  }): Promise<AgentIdentityRevision | undefined> {
    const row = await this.db.get<RawAgentIdentityRow>(
      `SELECT revision, tenant_id, agent_id, identity_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_identity_revisions
       WHERE tenant_id = ? AND agent_id = ?
       ORDER BY revision DESC
       LIMIT 1`,
      [params.tenantId, params.agentId],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(params: {
    tenantId: string;
    agentId: string;
    revision: number;
  }): Promise<AgentIdentityRevision | undefined> {
    const row = await this.db.get<RawAgentIdentityRow>(
      `SELECT revision, tenant_id, agent_id, identity_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_identity_revisions
       WHERE tenant_id = ? AND agent_id = ? AND revision = ?
       LIMIT 1`,
      [params.tenantId, params.agentId, params.revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async set(params: {
    tenantId: string;
    agentId: string;
    identity: IdentityPackT;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<AgentIdentityRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalized = IdentityPackSchema.parse(params.identity);
    const identityJson = JSON.stringify(normalized);

    const row = await this.db.get<RawAgentIdentityRow>(
      `INSERT INTO agent_identity_revisions (
         tenant_id,
         agent_id,
         identity_json,
         created_at,
         created_by_json,
         reason,
         reverted_from_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING revision, tenant_id, agent_id, identity_json, created_at, created_by_json, reason, reverted_from_revision`,
      [
        params.tenantId,
        params.agentId,
        identityJson,
        createdAt,
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) {
      throw new Error("agent identity insert failed");
    }

    return rowToRevision(row);
  }

  async revertToRevision(params: {
    tenantId: string;
    agentId: string;
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<AgentIdentityRevision> {
    const target = await this.getByRevision(params);
    if (!target) {
      throw new Error(`agent identity revision ${String(params.revision)} not found`);
    }

    return await this.set({
      tenantId: params.tenantId,
      agentId: params.agentId,
      identity: target.identity,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }

  async ensureSeeded(params: {
    tenantId: string;
    agentId: string;
    defaultIdentity: IdentityPackT;
    createdBy?: unknown;
    reason?: string;
  }): Promise<AgentIdentityRevision> {
    const latest = await this.getLatest({ tenantId: params.tenantId, agentId: params.agentId });
    if (latest) return latest;

    return await this.set({
      tenantId: params.tenantId,
      agentId: params.agentId,
      identity: params.defaultIdentity,
      createdBy: params.createdBy,
      reason: params.reason ?? "seed",
    });
  }
}
