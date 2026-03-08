import { createHash } from "node:crypto";
import { AgentConfig as AgentConfigSchema } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type AgentConfig = AgentConfigT;
type AgentConfigFactory = AgentConfig | (() => AgentConfig | Promise<AgentConfig>);

export type AgentConfigRevision = {
  revision: number;
  tenantId: string;
  agentId: string;
  config: AgentConfig;
  configSha256: string;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawAgentConfigRow {
  revision: number;
  tenant_id: string;
  agent_id: string;
  config_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseAgentConfigOrThrow(row: RawAgentConfigRow): AgentConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json) as unknown;
  } catch (err) {
    throw new Error(`agent config revision ${String(row.revision)} has invalid JSON`, {
      cause: err,
    });
  }

  const config = AgentConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw new Error(
      `agent config revision ${String(row.revision)} failed schema validation: ${config.error.message}`,
    );
  }

  return config.data;
}

function rowToRevision(row: RawAgentConfigRow): AgentConfigRevision {
  const config = parseAgentConfigOrThrow(row);
  const configSha256 = createHash("sha256").update(row.config_json).digest("hex");
  return {
    revision: row.revision,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    config,
    configSha256,
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

export class AgentConfigDal {
  constructor(private readonly db: SqlDb) {}

  private async resolveDefaultConfig(defaultConfig: AgentConfigFactory): Promise<AgentConfig> {
    if (typeof defaultConfig === "function") {
      return await defaultConfig();
    }
    return defaultConfig;
  }

  async listRevisions(params: {
    tenantId: string;
    agentId: string;
    limit?: number;
  }): Promise<AgentConfigRevision[]> {
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(200, Math.floor(params.limit)))
        : 50;

    const rows = await this.db.all<RawAgentConfigRow>(
      `SELECT revision, tenant_id, agent_id, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_configs
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
  }): Promise<AgentConfigRevision | undefined> {
    const row = await this.db.get<RawAgentConfigRow>(
      `SELECT revision, tenant_id, agent_id, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_configs
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
  }): Promise<AgentConfigRevision | undefined> {
    const row = await this.db.get<RawAgentConfigRow>(
      `SELECT revision, tenant_id, agent_id, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM agent_configs
       WHERE tenant_id = ? AND agent_id = ? AND revision = ?
       LIMIT 1`,
      [params.tenantId, params.agentId, params.revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async set(params: {
    tenantId: string;
    agentId: string;
    config: AgentConfig;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<AgentConfigRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalizedConfig = AgentConfigSchema.parse(params.config);
    const configJson = JSON.stringify(normalizedConfig);

    const row = await this.db.get<RawAgentConfigRow>(
      `INSERT INTO agent_configs (
         tenant_id,
         agent_id,
         config_json,
         created_at,
         created_by_json,
         reason,
         reverted_from_revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING revision, tenant_id, agent_id, config_json, created_at, created_by_json, reason, reverted_from_revision`,
      [
        params.tenantId,
        params.agentId,
        configJson,
        createdAt,
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) {
      throw new Error("agent config insert failed");
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
  }): Promise<AgentConfigRevision> {
    const target = await this.getByRevision({
      tenantId: params.tenantId,
      agentId: params.agentId,
      revision: params.revision,
    });
    if (!target) {
      throw new Error(`agent config revision ${String(params.revision)} not found`);
    }

    return await this.set({
      tenantId: params.tenantId,
      agentId: params.agentId,
      config: target.config,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }

  async ensureSeeded(params: {
    tenantId: string;
    agentId: string;
    defaultConfig: AgentConfigFactory;
    createdBy?: unknown;
    reason?: string;
  }): Promise<AgentConfigRevision> {
    const latest = await this.getLatest({ tenantId: params.tenantId, agentId: params.agentId });
    if (latest) return latest;

    return await this.set({
      tenantId: params.tenantId,
      agentId: params.agentId,
      config: await this.resolveDefaultConfig(params.defaultConfig),
      createdBy: params.createdBy,
      reason: params.reason ?? "seed",
      occurredAtIso: new Date().toISOString(),
      revertedFromRevision: undefined,
    });
  }
}
