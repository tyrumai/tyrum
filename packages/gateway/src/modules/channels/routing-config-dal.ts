import { createHash, randomUUID } from "node:crypto";
import { RoutingConfig as RoutingConfigSchema } from "@tyrum/schemas";
import type { RoutingConfig as RoutingConfigT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { computeEventHash } from "../audit/hash-chain.js";

export type RoutingConfig = RoutingConfigT;

export type RoutingConfigRevision = {
  revision: number;
  config: RoutingConfig;
  configSha256: string;
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

function parseRoutingConfigOrThrow(row: RawRoutingConfigRow): RoutingConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json) as unknown;
  } catch {
    throw new Error(`routing config revision ${String(row.revision)} has invalid JSON`);
  }

  const config = RoutingConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw new Error(
      `routing config revision ${String(row.revision)} failed schema validation: ${config.error.message}`,
    );
  }

  return config.data;
}

function rowToRevision(row: RawRoutingConfigRow): RoutingConfigRevision {
  const config = parseRoutingConfigOrThrow(row);
  const configSha256 = createHash("sha256").update(row.config_json).digest("hex");
  return {
    revision: row.revision,
    config,
    configSha256,
    createdAt: normalizeTime(row.created_at),
    createdBy: parseJsonOrFallback(row.created_by_json, {}),
    reason: row.reason ?? undefined,
  };
}

const ROUTING_CONFIG_AUDIT_PLAN_ID = "routing.config";

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === "23505") return true; // Postgres unique_violation
    if (typeof code === "string" && code.toUpperCase().startsWith("SQLITE_CONSTRAINT")) {
      return true;
    }
  }
  return false;
}

async function appendAuditEventNext(
  tx: SqlDb,
  event: {
    replayId: string;
    planId: string;
    occurredAt: string;
    action: unknown;
  },
): Promise<void> {
  const actionJson = JSON.stringify(event.action);

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const savepoint = `tyrum_routing_config_audit_${attempt + 1}`;
    await tx.exec(`SAVEPOINT ${savepoint}`);

    try {
      const lastRow = await tx.get<{ step_index: number; event_hash: string | null }>(
        "SELECT step_index, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index DESC LIMIT 1",
        [event.planId],
      );
      const prevHash = lastRow?.event_hash ?? null;
      const stepIndex = (lastRow?.step_index ?? -1) + 1;
      if (stepIndex < 0) {
        throw new Error("planner_events step_index overflow");
      }

      const eventHash = computeEventHash(
        {
          plan_id: event.planId,
          step_index: stepIndex,
          occurred_at: event.occurredAt,
          action: actionJson,
        },
        prevHash,
      );

      const inserted = await tx.get<{ id: number }>(
        `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          event.replayId,
          event.planId,
          stepIndex,
          event.occurredAt,
          actionJson,
          prevHash,
          eventHash,
        ],
      );

      if (!inserted) {
        throw new Error("planner_events insert returned no row");
      }

      await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return;
    } catch (err) {
      try {
        await tx.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        // ignore
      }

      if (isUniqueViolation(err)) {
        continue;
      }

      throw err;
    }
  }

  throw new Error("failed to append routing config audit event after retries");
}

export class RoutingConfigDal {
  constructor(private readonly db: SqlDb) {}

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
    const replayId = `routing-config-${randomUUID()}`;

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawRoutingConfigRow>(
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

      await appendAuditEventNext(tx, {
        replayId,
        planId: ROUTING_CONFIG_AUDIT_PLAN_ID,
        occurredAt: createdAt,
        action: {
          type: "routing.config.updated",
          revision: row.revision,
          reason: params.reason,
          created_by: params.createdBy ?? {},
          config_sha256: configSha256,
        },
      });

      const persisted = rowToRevision(row);
      return { ...persisted, configSha256 };
    });
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
