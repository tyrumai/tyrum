import { randomUUID } from "node:crypto";
import { sqlBoolParam } from "../../statestore/sql.js";
import type { SqlDb } from "../../statestore/types.js";

export const DEFAULT_TENANT_KEY = "default" as const;
export const DEFAULT_AGENT_KEY = "default" as const;
export const DEFAULT_WORKSPACE_KEY = "default" as const;

// Seeded by the v2 rebuild migrations.
export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001" as const;
export const DEFAULT_AGENT_ID = "00000000-0000-4000-8000-000000000002" as const;
export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000003" as const;

export interface ScopeKeys {
  tenantKey: string;
  agentKey: string;
  workspaceKey: string;
}

export interface ScopeIds {
  tenantId: string;
  agentId: string;
  workspaceId: string;
}

export interface PrimaryAgentRecord {
  agentId: string;
  agentKey: string;
}

export class ScopeNotFoundError extends Error {
  readonly code = "not_found";

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScopeNotFoundError";
  }
}

export function requireTenantIdValue(
  tenantId: string | null | undefined,
  message = "tenantId is required",
): string {
  const normalized = typeof tenantId === "string" ? tenantId.trim() : "";
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

export function normalizeScopeKeys(input?: Partial<ScopeKeys>): ScopeKeys {
  const tenantKey = input?.tenantKey?.trim() || DEFAULT_TENANT_KEY;
  const agentKey = input?.agentKey?.trim() || DEFAULT_AGENT_KEY;
  const workspaceKey = input?.workspaceKey?.trim() || DEFAULT_WORKSPACE_KEY;
  return {
    tenantKey: tenantKey.length > 0 ? tenantKey : DEFAULT_TENANT_KEY,
    agentKey: agentKey.length > 0 ? agentKey : DEFAULT_AGENT_KEY,
    workspaceKey: workspaceKey.length > 0 ? workspaceKey : DEFAULT_WORKSPACE_KEY,
  };
}

export async function requirePrimaryAgentKey(
  identityScopeDal: IdentityScopeDal,
  tenantId: string,
): Promise<string> {
  const agentKey = await identityScopeDal.resolvePrimaryAgentKey(tenantId);
  if (!agentKey) {
    throw new ScopeNotFoundError("primary agent not found", { tenantId });
  }
  return agentKey;
}

export async function requirePrimaryAgentId(
  identityScopeDal: IdentityScopeDal,
  tenantId: string,
): Promise<string> {
  const agentId = await identityScopeDal.resolvePrimaryAgentId(tenantId);
  if (!agentId) {
    throw new ScopeNotFoundError("primary agent not found", { tenantId });
  }
  return agentId;
}

export async function resolveRequestedAgentKey(input: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey?: string | null;
}): Promise<string> {
  if (input.agentKey === undefined || input.agentKey === null) {
    return await requirePrimaryAgentKey(input.identityScopeDal, input.tenantId);
  }
  const normalized = input.agentKey.trim();
  if (!normalized) {
    throw new Error("agent_key must be a non-empty string");
  }
  return normalized;
}

type Cached<T> = { value: T; expiresAtMs: number };

export class IdentityScopeDal {
  private readonly tenantCache = new Map<string, Cached<string>>();
  private readonly agentCache = new Map<string, Cached<string>>();
  private readonly primaryAgentCache = new Map<string, Cached<PrimaryAgentRecord>>();
  private readonly agentKeyCache = new Map<string, Cached<string>>();
  private readonly workspaceCache = new Map<string, Cached<string>>();

  constructor(
    private readonly db: SqlDb,
    private readonly opts?: { cacheTtlMs?: number },
  ) {}

  private cacheTtlMs(): number {
    const ttl = this.opts?.cacheTtlMs ?? 5 * 60_000;
    return Math.max(5_000, ttl);
  }

  private getCached<T>(map: Map<string, Cached<T>>, key: string): T | undefined {
    const now = Date.now();
    const cached = map.get(key);
    if (!cached) return undefined;
    if (cached.expiresAtMs <= now) {
      map.delete(key);
      return undefined;
    }
    return cached.value;
  }

  private setCached<T>(map: Map<string, Cached<T>>, key: string, value: T): void {
    map.set(key, { value, expiresAtMs: Date.now() + this.cacheTtlMs() });
  }

  private deleteCached<T>(map: Map<string, Cached<T>>, key: string): void {
    map.delete(key);
  }

  async ensureTenantId(tenantKey: string): Promise<string> {
    const key = tenantKey.trim() || "default";
    const cached = this.getCached(this.tenantCache, key);
    if (cached) return cached;

    const found = await this.db.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenants WHERE tenant_key = ? LIMIT 1",
      [key],
    );
    if (found?.tenant_id) {
      this.setCached(this.tenantCache, key, found.tenant_id);
      return found.tenant_id;
    }

    const tenantId = randomUUID();
    const inserted = await this.db.get<{ tenant_id: string }>(
      `INSERT INTO tenants (tenant_id, tenant_key)
       VALUES (?, ?)
       ON CONFLICT (tenant_key) DO NOTHING
       RETURNING tenant_id`,
      [tenantId, key],
    );
    const resolved =
      inserted?.tenant_id ??
      (
        await this.db.get<{ tenant_id: string }>(
          "SELECT tenant_id FROM tenants WHERE tenant_key = ? LIMIT 1",
          [key],
        )
      )?.tenant_id;
    if (!resolved) {
      throw new Error("failed to ensure tenant");
    }

    this.setCached(this.tenantCache, key, resolved);
    return resolved;
  }

  async resolveTenantId(tenantKey: string): Promise<string | null> {
    const key = tenantKey.trim() || DEFAULT_TENANT_KEY;
    const cached = this.getCached(this.tenantCache, key);
    if (cached) return cached;

    const found = await this.db.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenants WHERE tenant_key = ? LIMIT 1",
      [key],
    );
    if (!found?.tenant_id) return null;

    this.setCached(this.tenantCache, key, found.tenant_id);
    return found.tenant_id;
  }

  async resolveAgentId(tenantId: string, agentKey: string): Promise<string | null> {
    const key = agentKey.trim() || DEFAULT_AGENT_KEY;
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.agentCache, cacheKey);
    if (cached) return cached;

    const found = await this.db.get<{ agent_id: string }>(
      "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ? LIMIT 1",
      [tenantId, key],
    );
    if (!found?.agent_id) return null;

    this.setCached(this.agentCache, cacheKey, found.agent_id);
    this.setCached(this.agentKeyCache, `${tenantId}:${found.agent_id}`, key);
    return found.agent_id;
  }

  async resolvePrimaryAgent(tenantId: string): Promise<PrimaryAgentRecord | null> {
    const cached = this.getCached(this.primaryAgentCache, tenantId);
    if (cached) return cached;

    const found = await this.db.get<{ agent_id: string; agent_key: string }>(
      `SELECT agent_id, agent_key
       FROM agents
       WHERE tenant_id = ? AND is_primary = ?
       LIMIT 1`,
      [tenantId, sqlBoolParam(this.db, true)],
    );
    if (!found?.agent_id || !found.agent_key) return null;

    const primary = { agentId: found.agent_id, agentKey: found.agent_key };
    this.setCached(this.primaryAgentCache, tenantId, primary);
    this.setCached(this.agentCache, `${tenantId}:${found.agent_key}`, found.agent_id);
    this.setCached(this.agentKeyCache, `${tenantId}:${found.agent_id}`, found.agent_key);
    return primary;
  }

  async resolvePrimaryAgentId(tenantId: string): Promise<string | null> {
    const primary = await this.resolvePrimaryAgent(tenantId);
    return primary?.agentId ?? null;
  }

  async resolvePrimaryAgentKey(tenantId: string): Promise<string | null> {
    const primary = await this.resolvePrimaryAgent(tenantId);
    return primary?.agentKey ?? null;
  }

  async resolveAgentKey(tenantId: string, agentId: string): Promise<string | null> {
    const key = agentId.trim();
    if (key.length === 0) return null;

    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.agentKeyCache, cacheKey);
    if (cached) return cached;

    const found = await this.db.get<{ agent_key: string }>(
      "SELECT agent_key FROM agents WHERE tenant_id = ? AND agent_id = ? LIMIT 1",
      [tenantId, key],
    );
    if (!found?.agent_key) return null;

    this.setCached(this.agentKeyCache, cacheKey, found.agent_key);
    this.setCached(this.agentCache, `${tenantId}:${found.agent_key}`, key);
    return found.agent_key;
  }

  async ensureAgentId(tenantId: string, agentKey: string): Promise<string> {
    const key = agentKey.trim() || "default";
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.agentCache, cacheKey);
    if (cached) return cached;

    const maybePromoteDefaultPrimary = async (agentId: string): Promise<void> => {
      if (key !== DEFAULT_AGENT_KEY) return;
      const primary = await this.resolvePrimaryAgentId(tenantId);
      if (primary) return;
      await this.db.run(`UPDATE agents SET is_primary = ? WHERE tenant_id = ? AND agent_id = ?`, [
        sqlBoolParam(this.db, true),
        tenantId,
        agentId,
      ]);
      this.rememberPrimaryAgent(tenantId, key, agentId);
    };

    const found = await this.db.get<{ agent_id: string }>(
      "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ? LIMIT 1",
      [tenantId, key],
    );
    if (found?.agent_id) {
      await maybePromoteDefaultPrimary(found.agent_id);
      this.setCached(this.agentCache, cacheKey, found.agent_id);
      this.setCached(this.agentKeyCache, `${tenantId}:${found.agent_id}`, key);
      return found.agent_id;
    }

    const agentId = randomUUID();
    const inserted = await this.db.get<{ agent_id: string }>(
      `INSERT INTO agents (tenant_id, agent_id, agent_key)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, agent_key) DO NOTHING
       RETURNING agent_id`,
      [tenantId, agentId, key],
    );
    const resolved =
      inserted?.agent_id ??
      (
        await this.db.get<{ agent_id: string }>(
          "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ? LIMIT 1",
          [tenantId, key],
        )
      )?.agent_id;
    if (!resolved) {
      throw new Error("failed to ensure agent");
    }

    await maybePromoteDefaultPrimary(resolved);
    this.setCached(this.agentCache, cacheKey, resolved);
    this.setCached(this.agentKeyCache, `${tenantId}:${resolved}`, key);
    return resolved;
  }

  async resolveWorkspaceId(tenantId: string, workspaceKey: string): Promise<string | null> {
    const key = workspaceKey.trim() || DEFAULT_WORKSPACE_KEY;
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.workspaceCache, cacheKey);
    if (cached) return cached;

    const found = await this.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_key = ? LIMIT 1",
      [tenantId, key],
    );
    if (!found?.workspace_id) return null;

    this.setCached(this.workspaceCache, cacheKey, found.workspace_id);
    return found.workspace_id;
  }

  async ensureWorkspaceId(tenantId: string, workspaceKey: string): Promise<string> {
    const key = workspaceKey.trim() || "default";
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.workspaceCache, cacheKey);
    if (cached) return cached;

    const found = await this.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_key = ? LIMIT 1",
      [tenantId, key],
    );
    if (found?.workspace_id) {
      this.setCached(this.workspaceCache, cacheKey, found.workspace_id);
      return found.workspace_id;
    }

    const workspaceId = randomUUID();
    const inserted = await this.db.get<{ workspace_id: string }>(
      `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, workspace_key) DO NOTHING
       RETURNING workspace_id`,
      [tenantId, workspaceId, key],
    );
    const resolved =
      inserted?.workspace_id ??
      (
        await this.db.get<{ workspace_id: string }>(
          "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_key = ? LIMIT 1",
          [tenantId, key],
        )
      )?.workspace_id;
    if (!resolved) {
      throw new Error("failed to ensure workspace");
    }

    this.setCached(this.workspaceCache, cacheKey, resolved);
    return resolved;
  }

  async ensureMembership(tenantId: string, agentId: string, workspaceId: string): Promise<void> {
    await this.db.run(
      `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING`,
      [tenantId, agentId, workspaceId],
    );
  }

  async hasMembership(tenantId: string, agentId: string, workspaceId: string): Promise<boolean> {
    const row = await this.db.get<{ found: 1 }>(
      `SELECT 1 AS found
       FROM agent_workspaces
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
       LIMIT 1`,
      [tenantId, agentId, workspaceId],
    );
    return row?.found === 1;
  }

  async resolveExistingScopeIdsForTenant(input: {
    tenantId: string;
    agentKey: string;
    workspaceKey: string;
  }): Promise<Omit<ScopeIds, "tenantId"> | null> {
    const agentId = await this.resolveAgentId(input.tenantId, input.agentKey);
    if (!agentId) return null;

    const workspaceId = await this.resolveWorkspaceId(input.tenantId, input.workspaceKey);
    if (!workspaceId) return null;

    const hasMembership = await this.hasMembership(input.tenantId, agentId, workspaceId);
    if (!hasMembership) return null;

    return { agentId, workspaceId };
  }

  async resolveScopeIds(input?: Partial<ScopeKeys>): Promise<ScopeIds> {
    const keys = normalizeScopeKeys(input);
    const tenantId = await this.ensureTenantId(keys.tenantKey);
    const agentId = await this.ensureAgentId(tenantId, keys.agentKey);
    const workspaceId = await this.ensureWorkspaceId(tenantId, keys.workspaceKey);
    await this.ensureMembership(tenantId, agentId, workspaceId);
    return { tenantId, agentId, workspaceId };
  }

  async resolveExistingScopeIds(input?: Partial<ScopeKeys>): Promise<ScopeIds | null> {
    const keys = normalizeScopeKeys(input);
    const tenantId = await this.resolveTenantId(keys.tenantKey);
    if (!tenantId) return null;

    const resolved = await this.resolveExistingScopeIdsForTenant({
      tenantId,
      agentKey: keys.agentKey,
      workspaceKey: keys.workspaceKey,
    });
    if (!resolved) return null;

    return { tenantId, agentId: resolved.agentId, workspaceId: resolved.workspaceId };
  }

  rememberAgentId(tenantId: string, agentKey: string, agentId: string): void {
    const key = agentKey.trim() || DEFAULT_AGENT_KEY;
    this.setCached(this.agentCache, `${tenantId}:${key}`, agentId);
    this.setCached(this.agentKeyCache, `${tenantId}:${agentId}`, key);
  }

  forgetAgentId(tenantId: string, agentKey: string): void {
    const key = agentKey.trim() || DEFAULT_AGENT_KEY;
    const cacheKey = `${tenantId}:${key}`;
    const cachedAgentId = this.getCached(this.agentCache, cacheKey);
    this.deleteCached(this.agentCache, cacheKey);
    if (cachedAgentId) {
      this.deleteCached(this.agentKeyCache, `${tenantId}:${cachedAgentId}`);
    }
  }

  rememberPrimaryAgent(tenantId: string, agentKey: string, agentId: string): void {
    const key = agentKey.trim() || DEFAULT_AGENT_KEY;
    this.setCached(this.primaryAgentCache, tenantId, { agentId, agentKey: key });
    this.setCached(this.agentCache, `${tenantId}:${key}`, agentId);
    this.setCached(this.agentKeyCache, `${tenantId}:${agentId}`, key);
  }
}
