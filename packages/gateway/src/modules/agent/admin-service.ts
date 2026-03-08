import { randomUUID } from "node:crypto";
import {
  IdentityPack,
  ManagedAgentDeleteResponse,
  ManagedAgentDetail,
  ManagedAgentSummary,
} from "@tyrum/schemas";
import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  ManagedAgentDeleteResponse as ManagedAgentDeleteResponseT,
  ManagedAgentDetail as ManagedAgentDetailT,
  ManagedAgentSummary as ManagedAgentSummaryT,
} from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import { DEFAULT_AGENT_KEY, DEFAULT_WORKSPACE_KEY } from "../identity/scope.js";
import { AgentConfigDal } from "../config/agent-config-dal.js";
import { AgentIdentityDal } from "./identity-dal.js";
import { buildDefaultAgentConfig } from "./default-config.js";
import {
  applyPersonaToIdentity,
  listLatestAgentConfigsByAgentId,
  resolveAgentPersona,
} from "./persona.js";
import { escapeLikePattern } from "../../utils/sql-like.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";

type AgentRow = {
  agent_id: string;
  agent_key: string;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

type LatestIdentityRow = {
  agent_id: string;
  identity_json: string;
};

type ActiveRunRow = {
  run_id: string;
};

export class AgentAlreadyExistsError extends Error {}
export class AgentDeleteConflictError extends Error {}

function isSqliteBusyError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && code.toUpperCase().startsWith("SQLITE_BUSY");
  }
  return false;
}

async function waitForAgentRow(params: {
  db: SqlDb;
  tenantId: string;
  agentKey: string;
  attempts?: number;
  delayMs?: number;
}): Promise<AgentRow | undefined> {
  const attempts = params.attempts ?? 5;
  const delayMs = params.delayMs ?? 20;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = await getAgentRow(params.db, params.tenantId, params.agentKey);
    if (row) return row;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  return undefined;
}

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function synthesizeIdentity(agentKey: string, config?: AgentConfigT | null): IdentityPackT {
  const persona = resolveAgentPersona({ agentKey, config });
  return IdentityPack.parse({
    meta: {
      name: persona.name,
      description: persona.description,
      style: {
        tone: persona.tone,
      },
    },
    body: "",
  });
}

function parseIdentityJson(row: LatestIdentityRow): IdentityPackT | undefined {
  try {
    const parsed = JSON.parse(row.identity_json) as unknown;
    const identity = IdentityPack.safeParse(parsed);
    return identity.success ? identity.data : undefined;
  } catch {
    // Intentional: ignore malformed historical identity rows so list/detail reads
    // can continue using synthesized or config-derived identity data.
    return undefined;
  }
}

async function listLatestIdentitiesByAgentId(
  db: SqlDb,
  tenantId: string,
): Promise<Map<string, IdentityPackT>> {
  const rows = await db.all<LatestIdentityRow>(
    `SELECT current.agent_id, current.identity_json
     FROM agent_identity_revisions AS current
     INNER JOIN (
       SELECT agent_id, MAX(revision) AS revision
       FROM agent_identity_revisions
       WHERE tenant_id = ?
       GROUP BY agent_id
     ) AS latest
       ON latest.agent_id = current.agent_id
      AND latest.revision = current.revision
     WHERE current.tenant_id = ?`,
    [tenantId, tenantId],
  );

  return new Map(
    rows
      .map((row) => {
        const identity = parseIdentityJson(row);
        return identity ? ([row.agent_id, identity] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, IdentityPackT] => entry !== undefined),
  );
}

async function getAgentRow(
  db: SqlDb,
  tenantId: string,
  agentKey: string,
): Promise<AgentRow | undefined> {
  return await db.get<AgentRow>(
    `SELECT agent_id, agent_key, created_at, updated_at
     FROM agents
     WHERE tenant_id = ? AND agent_key = ?
     LIMIT 1`,
    [tenantId, agentKey],
  );
}

function toSummary(input: {
  row: AgentRow;
  config?: AgentConfigT | null;
  identity?: IdentityPackT | null;
}): ManagedAgentSummaryT {
  return ManagedAgentSummary.parse({
    agent_id: input.row.agent_id,
    agent_key: input.row.agent_key,
    created_at: normalizeTime(input.row.created_at),
    updated_at: normalizeTime(input.row.updated_at),
    has_config: Boolean(input.config),
    has_identity: Boolean(input.identity),
    can_delete: input.row.agent_key !== DEFAULT_AGENT_KEY,
    persona: resolveAgentPersona({
      agentKey: input.row.agent_key,
      config: input.config,
      identity: input.identity,
    }),
  });
}

function buildEffectiveConfig(input: {
  stateMode: GatewayStateMode;
  agentKey: string;
  config?: AgentConfigT | null;
  identity?: IdentityPackT | null;
}): AgentConfigT {
  if (input.config) return input.config;
  const persona = resolveAgentPersona({
    agentKey: input.agentKey,
    identity: input.identity,
  });
  return buildDefaultAgentConfig(input.stateMode, persona);
}

function buildEffectiveIdentity(input: {
  agentKey: string;
  config?: AgentConfigT | null;
  identity?: IdentityPackT | null;
}): IdentityPackT {
  const baseIdentity = input.identity ?? synthesizeIdentity(input.agentKey, input.config);
  const persona = resolveAgentPersona({
    agentKey: input.agentKey,
    config: input.config,
    identity: baseIdentity,
  });
  return applyPersonaToIdentity(baseIdentity, persona);
}

function toDetail(input: {
  stateMode: GatewayStateMode;
  row: AgentRow;
  config?: {
    revision: number;
    config: AgentConfigT;
    configSha256: string;
  } | null;
  identity?: {
    revision: number;
    identity: IdentityPackT;
    identitySha256: string;
  } | null;
}): ManagedAgentDetailT {
  const summary = toSummary({
    row: input.row,
    config: input.config?.config ?? null,
    identity: input.identity?.identity ?? null,
  });
  const config = buildEffectiveConfig({
    stateMode: input.stateMode,
    agentKey: input.row.agent_key,
    config: input.config?.config ?? null,
    identity: input.identity?.identity ?? null,
  });
  const identity = buildEffectiveIdentity({
    agentKey: input.row.agent_key,
    config,
    identity: input.identity?.identity ?? null,
  });

  return ManagedAgentDetail.parse({
    ...summary,
    config,
    identity,
    config_revision: input.config?.revision ?? null,
    identity_revision: input.identity?.revision ?? null,
    config_sha256: input.config?.configSha256 ?? null,
    identity_sha256: input.identity?.identitySha256 ?? null,
  });
}

async function assertNoActiveRuns(db: SqlDb, tenantId: string, agentKey: string): Promise<void> {
  const prefix = escapeLikePattern(`agent:${agentKey}:`);
  const active = await db.get<ActiveRunRow>(
    `SELECT run_id
     FROM execution_runs
     WHERE tenant_id = ?
       AND key LIKE ? ESCAPE '\\'
       AND status IN ('queued', 'running', 'paused')
     LIMIT 1`,
    [tenantId, `${prefix}%`],
  );
  if (active?.run_id) {
    throw new AgentDeleteConflictError(`agent '${agentKey}' has active execution runs`);
  }
}

export class AgentAdminService {
  private readonly configDal: AgentConfigDal;
  private readonly identityDal: AgentIdentityDal;

  constructor(
    private readonly deps: {
      db: SqlDb;
      identityScopeDal: IdentityScopeDal;
      stateMode: GatewayStateMode;
    },
  ) {
    this.configDal = new AgentConfigDal(deps.db);
    this.identityDal = new AgentIdentityDal(deps.db);
  }

  async list(tenantId: string): Promise<ManagedAgentSummaryT[]> {
    const rows = await this.deps.db.all<AgentRow>(
      `SELECT agent_id, agent_key, created_at, updated_at
       FROM agents
       WHERE tenant_id = ?
       ORDER BY CASE WHEN agent_key = 'default' THEN 0 ELSE 1 END, agent_key ASC`,
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
    identity?: IdentityPackT;
    createdBy?: unknown;
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
        await tx.run(
          `INSERT INTO agents (tenant_id, agent_id, agent_key)
           VALUES (?, ?, ?)`,
          [params.tenantId, agentId, params.agentKey],
        );
        await tx.run(
          `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
           VALUES (?, ?, ?)
           ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING`,
          [params.tenantId, agentId, workspaceId],
        );

        const requestedIdentity =
          params.identity ?? synthesizeIdentity(params.agentKey, params.config);
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
    return created;
  }

  async update(params: {
    tenantId: string;
    agentKey: string;
    config: AgentConfigT;
    identity?: IdentityPackT;
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
        params.identity ??
        existingIdentity?.identity ??
        synthesizeIdentity(params.agentKey, params.config);
      const effectiveIdentity = buildEffectiveIdentity({
        agentKey: params.agentKey,
        config: params.config,
        identity: requestedIdentity,
      });

      const [configRevision, identityRevision, refreshedRow] = await Promise.all([
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
        getAgentRow(tx, params.tenantId, params.agentKey),
      ]);

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
    if (params.agentKey === DEFAULT_AGENT_KEY) {
      throw new AgentDeleteConflictError("default agent cannot be deleted");
    }

    await this.deps.db.transaction(async (tx) => {
      await assertNoActiveRuns(tx, params.tenantId, params.agentKey);
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
}
