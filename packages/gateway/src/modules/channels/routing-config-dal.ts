import { createHash, randomUUID } from "node:crypto";
import { RoutingConfig as RoutingConfigSchema } from "@tyrum/schemas";
import type { RoutingConfig as RoutingConfigT } from "@tyrum/schemas";
import type { EventLog } from "../planner/event-log.js";
import type { SqlDb } from "../../statestore/types.js";

export type RoutingConfig = RoutingConfigT;

export type RoutingConfigRevision = {
  revision: number;
  config: RoutingConfig;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
};

interface RawRoutingConfigRow {
  revision: number;
  config_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOrFallback(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function rowToRevision(row: RawRoutingConfigRow): RoutingConfigRevision {
  const parsed = parseJsonOrFallback(row.config_json, { v: 1 });
  const config = RoutingConfigSchema.safeParse(parsed);
  return {
    revision: row.revision,
    config: config.success ? config.data : { v: 1 },
    createdAt: normalizeTime(row.created_at),
    createdBy: parseJsonOrFallback(row.created_by_json, {}),
    reason: row.reason ?? undefined,
  };
}

const ROUTING_CONFIG_AUDIT_PLAN_ID = "routing.config";

export class RoutingConfigDal {
  constructor(
    private readonly db: SqlDb,
    private readonly deps?: {
      eventLog?: EventLog;
    },
  ) {}

  async getLatest(): Promise<RoutingConfigRevision | undefined> {
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason
       FROM routing_configs
       ORDER BY revision DESC
       LIMIT 1`,
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(revision: number): Promise<RoutingConfigRevision | undefined> {
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason
       FROM routing_configs
       WHERE revision = ?`,
      [revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async set(params: {
    config: RoutingConfig;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<RoutingConfigRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalizedConfig = RoutingConfigSchema.parse(params.config);
    const configJson = JSON.stringify(normalizedConfig);
    const configSha256 = createHash("sha256").update(configJson).digest("hex");
    const row = await this.db.get<RawRoutingConfigRow>(
      `INSERT INTO routing_configs (config_json, created_at, created_by_json, reason)
       VALUES (?, ?, ?, ?)
       RETURNING revision, config_json, created_at, created_by_json, reason`,
      [
        configJson,
        createdAt,
        JSON.stringify(params.createdBy ?? {}),
        params.reason ?? null,
      ],
    );
    if (!row) {
      throw new Error("routing config insert failed");
    }

    const persisted = rowToRevision(row);

    if (this.deps?.eventLog) {
      await this.deps.eventLog.appendNext({
        replayId: `routing-config-${randomUUID()}`,
        planId: ROUTING_CONFIG_AUDIT_PLAN_ID,
        occurredAt: createdAt,
        action: {
          type: "routing.config.updated",
          revision: persisted.revision,
          reason: params.reason,
          created_by: params.createdBy ?? {},
          config_sha256: configSha256,
        },
      });
    }

    return persisted;
  }

  async revertToRevision(params: {
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<RoutingConfigRevision> {
    const target = await this.getByRevision(params.revision);
    if (!target) {
      throw new Error(`routing config revision ${String(params.revision)} not found`);
    }

    return await this.set({
      config: target.config,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
    });
  }
}
