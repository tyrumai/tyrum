import { createHash } from "node:crypto";
import { DeploymentConfig as DeploymentConfigSchema } from "@tyrum/schemas";
import type { DeploymentConfig as DeploymentConfigT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type DeploymentConfig = DeploymentConfigT;

export type DeploymentConfigRevision = {
  revision: number;
  config: DeploymentConfig;
  configSha256: string;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawDeploymentConfigRow {
  revision: number;
  config_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseDeploymentConfigOrThrow(row: RawDeploymentConfigRow): DeploymentConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json) as unknown;
  } catch (err) {
    throw new Error(`deployment config revision ${String(row.revision)} has invalid JSON`, {
      cause: err,
    });
  }

  const config = DeploymentConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw new Error(
      `deployment config revision ${String(row.revision)} failed schema validation: ${config.error.message}`,
    );
  }

  return config.data;
}

function rowToRevision(row: RawDeploymentConfigRow): DeploymentConfigRevision {
  const config = parseDeploymentConfigOrThrow(row);
  const configSha256 = createHash("sha256").update(row.config_json).digest("hex");
  return {
    revision: row.revision,
    config,
    configSha256,
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

export class DeploymentConfigDal {
  constructor(private readonly db: SqlDb) {}

  async getLatest(): Promise<DeploymentConfigRevision | undefined> {
    const row = await this.db.get<RawDeploymentConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM deployment_configs
       ORDER BY revision DESC
       LIMIT 1`,
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(revision: number): Promise<DeploymentConfigRevision | undefined> {
    const row = await this.db.get<RawDeploymentConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM deployment_configs
       WHERE revision = ?`,
      [revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async set(params: {
    config: DeploymentConfig;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<DeploymentConfigRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalizedConfig = DeploymentConfigSchema.parse(params.config);
    const configJson = JSON.stringify(normalizedConfig);
    const configSha256 = createHash("sha256").update(configJson).digest("hex");

    const row = await this.db.get<RawDeploymentConfigRow>(
      `INSERT INTO deployment_configs (config_json, created_at, created_by_json, reason, reverted_from_revision)
       VALUES (?, ?, ?, ?, ?)
       RETURNING revision, config_json, created_at, created_by_json, reason, reverted_from_revision`,
      [
        configJson,
        createdAt,
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
        params.revertedFromRevision ?? null,
      ],
    );
    if (!row) {
      throw new Error("deployment config insert failed");
    }

    const persisted = rowToRevision(row);
    return { ...persisted, configSha256 };
  }

  async revertToRevision(params: {
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<DeploymentConfigRevision> {
    const target = await this.getByRevision(params.revision);
    if (!target) {
      throw new Error(`deployment config revision ${String(params.revision)} not found`);
    }

    return await this.set({
      config: target.config,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }

  async ensureSeeded(params: {
    defaultConfig: DeploymentConfig;
    createdBy?: unknown;
    reason?: string;
  }): Promise<DeploymentConfigRevision> {
    const latest = await this.getLatest();
    if (latest) return latest;

    return await this.set({
      config: params.defaultConfig,
      createdBy: params.createdBy,
      reason: params.reason ?? "seed",
      occurredAtIso: new Date().toISOString(),
      revertedFromRevision: undefined,
    });
  }
}
