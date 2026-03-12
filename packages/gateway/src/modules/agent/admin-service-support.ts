import { IdentityPack, ManagedAgentDetail, ManagedAgentSummary } from "@tyrum/schemas";
import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  ManagedAgentDetail as ManagedAgentDetailT,
  ManagedAgentSummary as ManagedAgentSummaryT,
} from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_AGENT_KEY } from "../identity/scope.js";
import { buildDefaultAgentConfig } from "./default-config.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "./persona.js";

export type AgentRow = {
  agent_id: string;
  agent_key: string;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

type LatestIdentityRow = {
  agent_id: string;
  identity_json: string;
};

export function isSqliteBusyError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && code.toUpperCase().startsWith("SQLITE_BUSY");
  }
  return false;
}

export async function waitForAgentRow(params: {
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

export function synthesizeIdentity(agentKey: string, config?: AgentConfigT | null): IdentityPackT {
  const persona = resolveAgentPersona({ agentKey, config });
  return IdentityPack.parse({
    meta: {
      name: persona.name,
      style: {
        tone: persona.tone,
      },
    },
  });
}

function parseIdentityJson(row: LatestIdentityRow): IdentityPackT | undefined {
  try {
    const parsed = JSON.parse(row.identity_json) as unknown;
    const identity = IdentityPack.safeParse(parsed);
    return identity.success ? identity.data : undefined;
  } catch {
    // Intentional: invalid persisted identity JSON should be treated as absent so listing can continue.
    return undefined;
  }
}

export async function listLatestIdentitiesByAgentId(
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

export async function getAgentRow(
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

export function toSummary(input: {
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

export function buildEffectiveIdentity(input: {
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

export function toDetail(input: {
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
