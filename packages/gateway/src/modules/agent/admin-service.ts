import { randomUUID } from "node:crypto";
import { AgentCapabilitiesResponse, ManagedAgentDeleteResponse } from "@tyrum/contracts";
import type {
  AgentCapabilitiesResponse as AgentCapabilitiesResponseT,
  AgentConfig as AgentConfigT,
  ManagedAgentDeleteResponse as ManagedAgentDeleteResponseT,
  ManagedAgentDetail as ManagedAgentDetailT,
  ManagedAgentSummary as ManagedAgentSummaryT,
} from "@tyrum/contracts";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import { sqlBoolParam } from "../../statestore/sql.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import { DEFAULT_WORKSPACE_KEY } from "../identity/scope.js";
import { AgentConfigDal } from "../config/agent-config-dal.js";
import { AgentIdentityDal } from "./identity-dal.js";
import { buildDefaultAgentConfig } from "./default-config.js";
import { listAgentCapabilities } from "./capability-catalog.js";
import { touchAgentUpdatedAt } from "./updated-at.js";
import { listLatestAgentConfigsByAgentId } from "./persona.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";
import type { Logger } from "../observability/logger.js";
import type { PluginCatalogProvider } from "../plugins/catalog-provider.js";
import type { PluginRegistry } from "../plugins/registry.js";
import {
  buildEffectiveIdentity,
  getAgentRow,
  isSqliteBusyError,
  listLatestIdentitiesByAgentId,
  synthesizeIdentity,
  toDetail,
  toSummary,
  waitForAgentRow,
} from "./admin-service-support.js";
import type { AgentRow } from "./admin-service-support.js";

export class AgentAlreadyExistsError extends Error {}
export class AgentDeleteConflictError extends Error {}
export class AgentRenameConflictError extends Error {}
async function assertNoActiveRuns(
  db: SqlDb,
  tenantId: string,
  agentId: string,
  agentKey: string,
): Promise<void> {
  const active = await db.get<{ run_id: string }>(
    `SELECT turn_id AS run_id
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     WHERE r.tenant_id = ?
       AND j.agent_id = ?
       AND r.status IN ('queued', 'running', 'paused')
     LIMIT 1`,
    [tenantId, agentId],
  );
  if (active?.run_id) {
    throw new AgentDeleteConflictError(`agent '${agentKey}' has active execution runs`);
  }
}

async function detachExecutionArtifactsForAgent(
  db: SqlDb,
  tenantId: string,
  agentId: string,
): Promise<void> {
  await db.run(
    `UPDATE artifacts
     SET agent_id = NULL
     WHERE tenant_id = ? AND agent_id = ?`,
    [tenantId, agentId],
  );
}

export class AgentAdminService {
  private readonly configDal: AgentConfigDal;
  private readonly identityDal: AgentIdentityDal;

  constructor(
    private readonly deps: {
      db: SqlDb;
      identityScopeDal: IdentityScopeDal;
      stateMode: GatewayStateMode;
      logger?: Logger;
      pluginCatalogProvider?: PluginCatalogProvider;
      plugins?: PluginRegistry;
    },
  ) {
    this.configDal = new AgentConfigDal(deps.db);
    this.identityDal = new AgentIdentityDal(deps.db);
  }

  async list(tenantId: string): Promise<ManagedAgentSummaryT[]> {
    const rows = await this.deps.db.all<AgentRow>(
      `SELECT agent_id, agent_key, is_primary, created_at, updated_at
       FROM agents
       WHERE tenant_id = ?
       ORDER BY is_primary DESC, agent_key ASC`,
      [tenantId],
    );
    const [configsByAgentId, identitiesByAgentId] = await Promise.all([
      listLatestAgentConfigsByAgentId(this.deps.db, tenantId),
      listLatestIdentitiesByAgentId(this.deps.db, tenantId),
    ]);

    return rows.map((row) =>
      toSummary({
        row,
        config: configsByAgentId.get(row.agent_id),
        identity: identitiesByAgentId.get(row.agent_id),
      }),
    );
  }

  async get(tenantId: string, agentKey: string): Promise<ManagedAgentDetailT | null> {
    const row = await getAgentRow(this.deps.db, tenantId, agentKey);
    if (!row) return null;

    const [configRevision, identityRevision] = await Promise.all([
      this.configDal.getLatest({ tenantId, agentId: row.agent_id }),
      this.identityDal.getLatest({ tenantId, agentId: row.agent_id }),
    ]);

    return toDetail({
      stateMode: this.deps.stateMode,
      row,
      config: configRevision
        ? {
            revision: configRevision.revision,
            config: configRevision.config,
            configSha256: configRevision.configSha256,
          }
        : null,
      identity: identityRevision
        ? {
            revision: identityRevision.revision,
            identity: identityRevision.identity,
            identitySha256: identityRevision.identitySha256,
          }
        : null,
    });
  }

  async create(params: {
    tenantId: string;
    agentKey: string;
    config: AgentConfigT;
    createdBy?: unknown;
    isPrimary?: boolean;
    reason?: string;
  }): Promise<ManagedAgentDetailT> {
    const workspaceId = await this.deps.identityScopeDal.ensureWorkspaceId(
      params.tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    const agentId = randomUUID();
    let created: ManagedAgentDetailT;
    try {
      created = await this.deps.db.transaction(async (tx) => {
        if (params.isPrimary) {
          await tx.run(
            `UPDATE agents
             SET is_primary = ?
             WHERE tenant_id = ? AND is_primary = ?`,
            [sqlBoolParam(tx, false), params.tenantId, sqlBoolParam(tx, true)],
          );
        }
        await tx.run(
          `INSERT INTO agents (tenant_id, agent_id, agent_key, is_primary)
           VALUES (?, ?, ?, ?)`,
          [params.tenantId, agentId, params.agentKey, sqlBoolParam(tx, Boolean(params.isPrimary))],
        );
        await tx.run(
          `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
           VALUES (?, ?, ?)
           ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING`,
          [params.tenantId, agentId, workspaceId],
        );

        const requestedIdentity = synthesizeIdentity(params.agentKey, params.config);
        const effectiveIdentity = buildEffectiveIdentity({
          agentKey: params.agentKey,
          config: params.config,
          identity: requestedIdentity,
        });

        const [configRevision, identityRevision] = await Promise.all([
          new AgentConfigDal(tx).set({
            tenantId: params.tenantId,
            agentId,
            config: params.config,
            createdBy: params.createdBy,
            reason: params.reason,
          }),
          new AgentIdentityDal(tx).set({
            tenantId: params.tenantId,
            agentId,
            identity: effectiveIdentity,
            createdBy: params.createdBy,
            reason: params.reason,
          }),
        ]);

        const row = await getAgentRow(tx, params.tenantId, params.agentKey);
        if (!row) {
          throw new Error("agent create failed");
        }

        return toDetail({
          stateMode: this.deps.stateMode,
          row,
          config: {
            revision: configRevision.revision,
            config: configRevision.config,
            configSha256: configRevision.configSha256,
          },
          identity: {
            revision: identityRevision.revision,
            identity: identityRevision.identity,
            identitySha256: identityRevision.identitySha256,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AgentAlreadyExistsError(`agent '${params.agentKey}' already exists`);
      }
      if (isSqliteBusyError(error)) {
        const existing = await waitForAgentRow({
          db: this.deps.db,
          tenantId: params.tenantId,
          agentKey: params.agentKey,
        });
        if (existing) {
          throw new AgentAlreadyExistsError(`agent '${params.agentKey}' already exists`);
        }
      }
      throw error;
    }

    this.deps.identityScopeDal.rememberAgentId(params.tenantId, params.agentKey, agentId);
    if (params.isPrimary) {
      this.deps.identityScopeDal.rememberPrimaryAgent(params.tenantId, params.agentKey, agentId);
    }
    return created;
  }

  async update(params: {
    tenantId: string;
    agentKey: string;
    config: AgentConfigT;
    createdBy?: unknown;
    reason?: string;
  }): Promise<ManagedAgentDetailT | null> {
    const row = await getAgentRow(this.deps.db, params.tenantId, params.agentKey);
    if (!row) return null;

    return await this.deps.db.transaction(async (tx) => {
      const existingIdentity = await new AgentIdentityDal(tx).getLatest({
        tenantId: params.tenantId,
        agentId: row.agent_id,
      });
      const requestedIdentity =
        existingIdentity?.identity ?? synthesizeIdentity(params.agentKey, params.config);
      const effectiveIdentity = buildEffectiveIdentity({
        agentKey: params.agentKey,
        config: params.config,
        identity: requestedIdentity,
      });

      const [configRevision, identityRevision] = await Promise.all([
        new AgentConfigDal(tx).set({
          tenantId: params.tenantId,
          agentId: row.agent_id,
          config: params.config,
          createdBy: params.createdBy,
          reason: params.reason,
        }),
        new AgentIdentityDal(tx).set({
          tenantId: params.tenantId,
          agentId: row.agent_id,
          identity: effectiveIdentity,
          createdBy: params.createdBy,
          reason: params.reason,
        }),
      ]);
      await touchAgentUpdatedAt(tx, {
        tenantId: params.tenantId,
        agentId: row.agent_id,
      });
      const refreshedRow = await getAgentRow(tx, params.tenantId, params.agentKey);

      if (!refreshedRow) {
        throw new Error("agent update failed");
      }

      return toDetail({
        stateMode: this.deps.stateMode,
        row: refreshedRow,
        config: {
          revision: configRevision.revision,
          config: configRevision.config,
          configSha256: configRevision.configSha256,
        },
        identity: {
          revision: identityRevision.revision,
          identity: identityRevision.identity,
          identitySha256: identityRevision.identitySha256,
        },
      });
    });
  }

  async delete(params: {
    tenantId: string;
    agentKey: string;
  }): Promise<ManagedAgentDeleteResponseT | null> {
    const row = await getAgentRow(this.deps.db, params.tenantId, params.agentKey);
    if (!row) return null;
    if (row.is_primary === true || row.is_primary === 1) {
      throw new AgentDeleteConflictError("primary agent cannot be deleted");
    }

    await this.deps.db.transaction(async (tx) => {
      await assertNoActiveRuns(tx, params.tenantId, row.agent_id, params.agentKey);
      // Artifact history keeps a composite (tenant_id, agent_id) relationship,
      // but tenant_id remains non-nullable. Clear agent_id explicitly so
      // artifact history survives agent deletion.
      await detachExecutionArtifactsForAgent(tx, params.tenantId, row.agent_id);
      const result = await tx.run(
        `DELETE FROM agents
         WHERE tenant_id = ? AND agent_id = ?`,
        [params.tenantId, row.agent_id],
      );
      if (result.changes < 1) {
        throw new Error("agent delete failed");
      }
    });

    this.deps.identityScopeDal.forgetAgentId(params.tenantId, params.agentKey);
    return ManagedAgentDeleteResponse.parse({
      agent_id: row.agent_id,
      agent_key: row.agent_key,
      deleted: true,
    });
  }

  async rename(params: {
    tenantId: string;
    agentKey: string;
    nextAgentKey: string;
    reason?: string;
  }): Promise<ManagedAgentDetailT | null> {
    const row = await getAgentRow(this.deps.db, params.tenantId, params.agentKey);
    if (!row) return null;
    if (row.agent_key === params.nextAgentKey) {
      return await this.get(params.tenantId, params.nextAgentKey);
    }

    try {
      await this.deps.db.transaction(async (tx) => {
        await tx.run(
          `UPDATE agents
           SET agent_key = ?, updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ? AND agent_id = ?`,
          [params.nextAgentKey, params.tenantId, row.agent_id],
        );
        await tx.run(
          `UPDATE oauth_pending
           SET agent_key = ?
           WHERE tenant_id = ? AND agent_key = ?`,
          [params.nextAgentKey, params.tenantId, row.agent_key],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AgentRenameConflictError(`agent '${params.nextAgentKey}' already exists`);
      }
      throw error;
    }

    this.deps.identityScopeDal.forgetAgentId(params.tenantId, row.agent_key);
    this.deps.identityScopeDal.rememberAgentId(params.tenantId, params.nextAgentKey, row.agent_id);
    if (row.is_primary === true || row.is_primary === 1) {
      this.deps.identityScopeDal.rememberPrimaryAgent(
        params.tenantId,
        params.nextAgentKey,
        row.agent_id,
      );
    }

    const renamed = await this.get(params.tenantId, params.nextAgentKey);
    if (!renamed) {
      throw new Error("agent rename failed");
    }
    return renamed;
  }

  async getCapabilities(tenantId: string, agentKey: string): Promise<AgentCapabilitiesResponseT> {
    const row = await getAgentRow(this.deps.db, tenantId, agentKey);
    const configRevision = row
      ? await this.configDal.getLatest({ tenantId, agentId: row.agent_id })
      : undefined;
    const config = configRevision?.config ?? buildDefaultAgentConfig(this.deps.stateMode);

    return AgentCapabilitiesResponse.parse(
      await listAgentCapabilities({
        config,
        db: this.deps.db,
        tenantId,
        agentKey,
        stateMode: this.deps.stateMode,
        logger: this.deps.logger,
        pluginCatalogProvider: this.deps.pluginCatalogProvider,
        plugins: this.deps.plugins,
      }),
    );
  }
}
