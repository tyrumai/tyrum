import { createHash, randomUUID } from "node:crypto";
import { RoutingConfig as RoutingConfigSchema } from "@tyrum/contracts";
import type { RoutingConfig as RoutingConfigT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import { insertPlannerEventNext, retryOnUniqueViolation } from "../planner/planner-events.js";
import { PlanDal } from "../planner/plan-dal.js";
import { DEFAULT_AGENT_KEY, DEFAULT_WORKSPACE_KEY, IdentityScopeDal } from "../identity/scope.js";

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
    tenantId: string;
    agentId: string;
    workspaceId: string;
    replayId: string;
    planKey: string;
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
        const planId = await new PlanDal(tx).ensurePlanId({
          tenantId: event.tenantId,
          planKey: event.planKey,
          agentId: event.agentId,
          workspaceId: event.workspaceId,
          kind: "audit",
          status: "active",
        });

        await insertPlannerEventNext<unknown>(tx, {
          tenantId: event.tenantId,
          replayId: event.replayId,
          planId,
          occurredAt: event.occurredAt,
          actionJson,
          returning: "*",
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

  async getLatest(tenantId: string): Promise<RoutingConfigRevision | undefined> {
    const resolvedTenantId = tenantId.trim();
    if (!resolvedTenantId) {
      throw new Error("tenantId is required");
    }
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM routing_configs
       WHERE tenant_id = ?
       ORDER BY revision DESC
       LIMIT 1`,
      [resolvedTenantId],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async getByRevision(
    tenantId: string,
    revision: number,
  ): Promise<RoutingConfigRevision | undefined> {
    const resolvedTenantId = tenantId.trim();
    if (!resolvedTenantId) {
      throw new Error("tenantId is required");
    }
    const row = await this.db.get<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM routing_configs
       WHERE tenant_id = ?
         AND revision = ?`,
      [resolvedTenantId, revision],
    );
    return row ? rowToRevision(row) : undefined;
  }

  async listRevisions(params: {
    tenantId: string;
    limit?: number;
  }): Promise<RoutingConfigRevision[]> {
    const tenantId = params.tenantId.trim();
    if (!tenantId) {
      throw new Error("tenantId is required");
    }
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.trunc(params.limit)))
        : 20;

    const rows = await this.db.all<RawRoutingConfigRow>(
      `SELECT revision, config_json, created_at, created_by_json, reason, reverted_from_revision
       FROM routing_configs
       WHERE tenant_id = ?
       ORDER BY revision DESC
       LIMIT ?`,
      [tenantId, limit],
    );
    return rows.map(rowToRevision);
  }

  async set(params: {
    tenantId: string;
    config: RoutingConfig;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
    revertedFromRevision?: number;
  }): Promise<RoutingConfigRevision> {
    const tenantId = params.tenantId.trim();
    if (!tenantId) throw new Error("tenantId is required");

    const createdAt = params.occurredAtIso ?? new Date().toISOString();
    const normalizedConfig = RoutingConfigSchema.parse(params.config);
    const configJson = JSON.stringify(normalizedConfig);
    const configSha256 = createHash("sha256").update(configJson).digest("hex");
    const replayId = `routing-config-${randomUUID()}`;

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawRoutingConfigRow>(
        `INSERT INTO routing_configs (tenant_id, config_json, created_at, created_by_json, reason, reverted_from_revision)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING revision, config_json, created_at, created_by_json, reason, reverted_from_revision`,
        [
          tenantId,
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

      const identityScopeDal = new IdentityScopeDal(tx);
      const agentId = await identityScopeDal.ensureAgentId(tenantId, DEFAULT_AGENT_KEY);
      const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, DEFAULT_WORKSPACE_KEY);
      await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

      await appendAuditEventNext(tx, {
        tenantId,
        agentId,
        workspaceId,
        replayId,
        planKey: ROUTING_CONFIG_AUDIT_PLAN_ID,
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
    tenantId: string;
    revision: number;
    createdBy?: unknown;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<RoutingConfigRevision> {
    const tenantId = params.tenantId.trim();
    if (!tenantId) {
      throw new Error("tenantId is required");
    }
    const target = await this.getByRevision(tenantId, params.revision);
    if (!target) {
      throw new Error(`routing config revision ${String(params.revision)} not found`);
    }

    return await this.set({
      tenantId,
      config: target.config,
      createdBy: params.createdBy,
      reason: params.reason,
      occurredAtIso: params.occurredAtIso,
      revertedFromRevision: params.revision,
    });
  }
}
