import { createHash, randomUUID } from "node:crypto";
import { RoutingConfig as RoutingConfigSchema } from "@tyrum/schemas";
import type { RoutingConfig as RoutingConfigT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import { insertPlannerEventNext, retryOnUniqueViolation } from "../planner/planner-events.js";

export type RoutingConfig = RoutingConfigT;

export type RoutingConfigRevision = {
  revision: number;
  config: RoutingConfig;
  configSha256: string;
  createdAt: string;
  createdBy: unknown;
  reason?: string;
  revertedFromRevision?: number;
};

interface RawRoutingConfigRow {
  revision: number;
  config_json: string;
  created_at: string | Date;
  created_by_json: string;
  reason: string | null;
  reverted_from_revision: number | null;
}

function parseRoutingConfigOrThrow(row: RawRoutingConfigRow): RoutingConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json) as unknown;
  } catch (err) {
    throw new Error(`routing config revision ${String(row.revision)} has invalid JSON`, {
      cause: err,
    });
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
    createdAt: normalizeDbDateTime(row.created_at),
    createdBy: safeJsonParse(row.created_by_json, {}),
    reason: row.reason ?? undefined,
    revertedFromRevision: row.reverted_from_revision ?? undefined,
  };
}

const ROUTING_CONFIG_AUDIT_PLAN_ID = "routing.config";

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

  await retryOnUniqueViolation(
    async (attempt) => {
      const savepoint = `tyrum_routing_config_audit_${attempt + 1}`;
      await tx.exec(`SAVEPOINT ${savepoint}`);

      try {
        await insertPlannerEventNext<{ id: number }>(tx, {
          replayId: event.replayId,
          planId: event.planId,
          occurredAt: event.occurredAt,
          actionJson,
          returning: "id",
        });

        await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (err) {
        try {
          await tx.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (rollbackErr) {
          // Intentional: rollback failures should not hide the original failure.
          void rollbackErr;
        }
        throw err;
      }
    },
    { failureMessage: "failed to append routing config audit event after retries" },
  );
}

export class RoutingConfigDal {
  constructor(private readonly db: SqlDb) {}

  async getLatest(): Promise<RoutingConfigRevision | undefined> {
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM routing_configs
       ORDER BY revision DESC
       LIMIT 1`,
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(revision: number): Promise<RoutingConfigRevision | undefined> {
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
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
    revertedFromRevision?: number;
  }): Promise<RoutingConfigRevision> {
    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalizedConfig = RoutingConfigSchema.parse(params.config);
    const configJson = JSON.stringify(normalizedConfig);
    const configSha256 = createHash("sha256").update(configJson).digest("hex");
    const replayId = `routing-config-${randomUUID()}`;

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawRoutingConfigRow>(
        `INSERT INTO routing_configs (config_json, created_at, created_by_json, reason, reverted_from_revision)
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
          ...(typeof params.revertedFromRevision === "number"
            ? { reverted_from_revision: params.revertedFromRevision }
            : {}),
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
      revertedFromRevision: params.revision,
    });
  }
}
