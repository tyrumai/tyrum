/**
 * System routes — bootstrap / root administration.
 *
 * Requires a system token (auth claim tenant_id === null).
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  AuthTokenIssueRequest,
  AuthTokenIssueResponse,
  AuthTokenRevokeRequest,
  AuthTokenRevokeResponse,
  DeploymentConfig,
  DeploymentConfigGetResponse,
  DeploymentConfigRevertRequest,
  DeploymentConfigUpdateRequest,
  DeploymentConfigUpdateResponse,
  DeploymentConfigRevertResponse,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantListResponse,
} from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import { requireAuthClaims } from "../modules/auth/claims.js";

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")) {
    return trimmed.replace(" ", "T") + "Z";
  }
  return trimmed;
}

type TenantRow = {
  tenant_id: string;
  tenant_key: string;
  name: string;
  status: "active" | "disabled";
  created_at: string | Date;
  updated_at: string | Date;
};

function toTenantContract(row: TenantRow) {
  return {
    tenant_id: row.tenant_id,
    tenant_key: row.tenant_key,
    name: row.name,
    status: row.status,
    created_at: normalizeTime(row.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(row.updated_at) ?? new Date().toISOString(),
  };
}

export interface SystemRouteDeps {
  db: SqlDb;
  authTokens: AuthTokenService;
}

export function createSystemRoutes(deps: SystemRouteDeps): Hono {
  const app = new Hono();

  app.get("/system/tenants", async (c) => {
    const rows = await deps.db.all<TenantRow>(
      `SELECT tenant_id, tenant_key, name, status, created_at, updated_at
       FROM tenants
       ORDER BY tenant_key ASC`,
      [],
    );

    const tenants = rows.map(toTenantContract);
    return c.json(TenantListResponse.parse({ tenants }));
  });

  app.post("/system/tenants", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = TenantCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const tenantKey = parsed.data.tenant_key.trim();
    const desiredName = parsed.data.name?.trim();
    const name = desiredName && desiredName.length > 0 ? desiredName : tenantKey;

    const existing = await deps.db.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenants WHERE tenant_key = ? LIMIT 1",
      [tenantKey],
    );
    if (existing?.tenant_id) {
      return c.json({ error: "conflict", message: "tenant already exists" }, 409);
    }

    const nowIso = new Date().toISOString();
    const tenantId = randomUUID();
    const row = await deps.db.get<TenantRow>(
      `INSERT INTO tenants (tenant_id, tenant_key, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       RETURNING tenant_id, tenant_key, name, status, created_at, updated_at`,
      [tenantId, tenantKey, name, nowIso, nowIso],
    );
    if (!row) {
      throw new Error("tenant insert failed");
    }

    // Seed default agent/workspace membership for the new tenant.
    const agentId = randomUUID();
    const workspaceId = randomUUID();
    await deps.db.run(
      `INSERT INTO agents (tenant_id, agent_id, agent_key)
       VALUES (?, ?, 'default')
       ON CONFLICT (tenant_id, agent_key) DO NOTHING`,
      [tenantId, agentId],
    );
    await deps.db.run(
      `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
       VALUES (?, ?, 'default')
       ON CONFLICT (tenant_id, workspace_key) DO NOTHING`,
      [tenantId, workspaceId],
    );
    const agentRow = await deps.db.get<{ agent_id: string }>(
      `SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = 'default' LIMIT 1`,
      [tenantId],
    );
    const workspaceRow = await deps.db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_key = 'default' LIMIT 1`,
      [tenantId],
    );
    if (agentRow?.agent_id && workspaceRow?.workspace_id) {
      await deps.db.run(
        `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
         VALUES (?, ?, ?)
         ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING`,
        [tenantId, agentRow.agent_id, workspaceRow.workspace_id],
      );
    }

    const tenant = TenantCreateResponse.shape.tenant.parse(toTenantContract(row));
    return c.json(TenantCreateResponse.parse({ tenant }), 201);
  });

  app.post("/system/tokens/issue", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = AuthTokenIssueRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    if (parsed.data.tenant_id === null && parsed.data.role !== "admin") {
      return c.json(
        { error: "invalid_request", message: "system tokens must have role=admin" },
        400,
      );
    }

    const issued = await deps.authTokens.issueToken({
      tenantId: parsed.data.tenant_id,
      role: parsed.data.role,
      scopes: parsed.data.scopes,
      deviceId: parsed.data.device_id,
      ttlSeconds: parsed.data.ttl_seconds,
    });

    return c.json(
      AuthTokenIssueResponse.parse({
        token: issued.token,
        token_id: issued.row.token_id,
        tenant_id: issued.row.tenant_id,
        role: issued.row.role,
        device_id: issued.row.device_id ?? undefined,
        scopes: JSON.parse(issued.row.scopes_json) as unknown,
        issued_at: issued.row.issued_at,
        expires_at: issued.row.expires_at ?? undefined,
      }),
      201,
    );
  });

  app.post("/system/tokens/revoke", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = AuthTokenRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revoked = await deps.authTokens.revokeToken(parsed.data.token_id);
    return c.json(
      AuthTokenRevokeResponse.parse({
        revoked,
        token_id: revoked ? parsed.data.token_id : undefined,
      }),
      revoked ? 200 : 404,
    );
  });

  // --- Deployment config (global; revisioned) ---

  app.get("/system/deployment-config", async (c) => {
    const revision = await new DeploymentConfigDal(deps.db).ensureSeeded({
      defaultConfig: DeploymentConfig.parse({}),
      createdBy: { kind: "bootstrap" },
      reason: "seed",
    });

    return c.json(
      DeploymentConfigGetResponse.parse({
        revision: revision.revision,
        config: revision.config,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason,
        reverted_from_revision: revision.revertedFromRevision,
      }),
      200,
    );
  });

  app.put("/system/deployment-config", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = DeploymentConfigUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const claims = requireAuthClaims(c);
    const revision = await new DeploymentConfigDal(deps.db).set({
      config: parsed.data.config,
      createdBy: { kind: "system.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });

    return c.json(
      DeploymentConfigUpdateResponse.parse({
        revision: revision.revision,
        config: revision.config,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason,
        reverted_from_revision: revision.revertedFromRevision,
      }),
      200,
    );
  });

  app.post("/system/deployment-config/revert", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = DeploymentConfigRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const claims = requireAuthClaims(c);
    const revision = await new DeploymentConfigDal(deps.db).revertToRevision({
      revision: parsed.data.revision,
      createdBy: { kind: "system.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });

    return c.json(
      DeploymentConfigRevertResponse.parse({
        revision: revision.revision,
        config: revision.config,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason,
        reverted_from_revision: revision.revertedFromRevision,
      }),
      200,
    );
  });

  return app;
}
