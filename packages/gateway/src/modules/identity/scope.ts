import { randomUUID } from "node:crypto";
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

type Cached<T> = { value: T; expiresAtMs: number };

export class IdentityScopeDal {
  private readonly tenantCache = new Map<string, Cached<string>>();
  private readonly agentCache = new Map<string, Cached<string>>();
  private readonly workspaceCache = new Map<string, Cached<string>>();

  constructor(
    private readonly db: SqlDb,
    private readonly opts?: { cacheTtlMs?: number },
  ) {}

  private cacheTtlMs(): number {
    const ttl = this.opts?.cacheTtlMs ?? 5 * 60_000;
    return Math.max(5_000, ttl);
  }

  private getCached(map: Map<string, Cached<string>>, key: string): string | undefined {
    const now = Date.now();
    const cached = map.get(key);
    if (!cached) return undefined;
    if (cached.expiresAtMs <= now) {
      map.delete(key);
      return undefined;
    }
    return cached.value;
  }

  private setCached(map: Map<string, Cached<string>>, key: string, value: string): void {
    map.set(key, { value, expiresAtMs: Date.now() + this.cacheTtlMs() });
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

  async ensureAgentId(tenantId: string, agentKey: string): Promise<string> {
    const key = agentKey.trim() || "default";
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.getCached(this.agentCache, cacheKey);
    if (cached) return cached;

    const found = await this.db.get<{ agent_id: string }>(
      "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ? LIMIT 1",
      [tenantId, key],
    );
    if (found?.agent_id) {
      this.setCached(this.agentCache, cacheKey, found.agent_id);
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

    this.setCached(this.agentCache, cacheKey, resolved);
    return resolved;
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

  async resolveScopeIds(input?: Partial<ScopeKeys>): Promise<ScopeIds> {
    const keys = normalizeScopeKeys(input);
    const tenantId = await this.ensureTenantId(keys.tenantKey);
    const agentId = await this.ensureAgentId(tenantId, keys.agentKey);
    const workspaceId = await this.ensureWorkspaceId(tenantId, keys.workspaceKey);
    await this.ensureMembership(tenantId, agentId, workspaceId);
    return { tenantId, agentId, workspaceId };
  }
}
