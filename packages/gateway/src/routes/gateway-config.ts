import { Hono } from "hono";
import { z } from "zod";
import { LifecycleHookDefinition, PolicyBundle } from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import type { IdentityScopeDal } from "../app/modules/identity/scope.js";
import { DEFAULT_WORKSPACE_KEY } from "../app/modules/identity/scope.js";
import { requireAuthClaims, requireTenantId } from "../app/modules/auth/claims.js";
import { LifecycleHookConfigDal } from "../app/modules/hooks/config-dal.js";
import { PolicyBundleConfigDal } from "../app/modules/policy/config-dal.js";
import { normalizeAgentKey } from "./config-key-utils.js";

const HooksUpdateRequest = z
  .object({
    hooks: z.array(LifecycleHookDefinition),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const PolicyUpdateRequest = z
  .object({
    bundle: PolicyBundle,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const RevertRequest = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export interface GatewayConfigRouteDeps {
  hooksDal: LifecycleHookConfigDal;
}

export interface PolicyConfigRouteDeps {
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  policyBundleDal: PolicyBundleConfigDal;
}

async function resolveExistingAgentId(
  deps: Pick<PolicyConfigRouteDeps, "db">,
  tenantId: string,
  agentKey: string,
): Promise<string | null> {
  const row = await deps.db.get<{ agent_id: string }>(
    `SELECT agent_id
     FROM agents
     WHERE tenant_id = ? AND agent_key = ?
     LIMIT 1`,
    [tenantId, agentKey],
  );
  return row?.agent_id ?? null;
}

function registerPolicyConfigRoutes(app: Hono, deps: PolicyConfigRouteDeps): void {
  const registerPolicyRoutes = (
    path: string,
    resolveReadScope: (
      c: any,
    ) => Promise<{ tenantId: string; agentId?: string; agentKey?: string } | null>,
    resolveWriteScope: (
      c: any,
    ) => Promise<{ tenantId: string; agentId?: string; agentKey?: string } | null>,
  ) => {
    app.get(path, async (c) => {
      const scope = await resolveReadScope(c);
      if (!scope) {
        return c.json({ error: "not_found", message: "agent not found" }, 404);
      }
      const revision = await deps.policyBundleDal.getLatest(
        scope.agentId
          ? { tenantId: scope.tenantId, scopeKind: "agent", agentId: scope.agentId }
          : { tenantId: scope.tenantId, scopeKind: "deployment" },
      );
      if (!revision) {
        return c.json({ error: "not_found", message: "policy bundle config not found" }, 404);
      }
      return c.json(
        {
          revision: revision.revision,
          bundle: revision.bundle,
          agent_key: scope.agentKey ?? null,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? null,
          reverted_from_revision: revision.revertedFromRevision ?? null,
        },
        200,
      );
    });

    app.get(`${path}/revisions`, async (c) => {
      const scope = await resolveReadScope(c);
      if (!scope) {
        return c.json({ error: "not_found", message: "agent not found" }, 404);
      }
      const revisions = await deps.policyBundleDal.listRevisions(
        scope.agentId
          ? { tenantId: scope.tenantId, scopeKind: "agent", agentId: scope.agentId }
          : { tenantId: scope.tenantId, scopeKind: "deployment" },
      );
      return c.json(
        {
          revisions: revisions.map((revision) => ({
            revision: revision.revision,
            agent_key: scope.agentKey ?? null,
            created_at: revision.createdAt,
            created_by: revision.createdBy,
            reason: revision.reason ?? null,
            reverted_from_revision: revision.revertedFromRevision ?? null,
          })),
        },
        200,
      );
    });

    app.put(path, async (c) => {
      const scope = await resolveWriteScope(c);
      if (!scope) {
        return c.json({ error: "not_found", message: "agent not found" }, 404);
      }
      const claims = requireAuthClaims(c);
      let body: unknown;
      try {
        body = (await c.req.json()) as unknown;
      } catch (err) {
        void err;
        return c.json({ error: "invalid_request", message: "invalid json" }, 400);
      }
      const parsed = PolicyUpdateRequest.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
      }
      const revision = await deps.policyBundleDal.set({
        scope: scope.agentId
          ? { tenantId: scope.tenantId, scopeKind: "agent", agentId: scope.agentId }
          : { tenantId: scope.tenantId, scopeKind: "deployment" },
        bundle: parsed.data.bundle,
        createdBy: { kind: "tenant.token", token_id: claims.token_id },
        reason: parsed.data.reason,
      });
      return c.json(
        {
          revision: revision.revision,
          bundle: revision.bundle,
          agent_key: scope.agentKey ?? null,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? null,
          reverted_from_revision: revision.revertedFromRevision ?? null,
        },
        200,
      );
    });

    app.post(`${path}/revert`, async (c) => {
      const scope = await resolveWriteScope(c);
      if (!scope) {
        return c.json({ error: "not_found", message: "agent not found" }, 404);
      }
      const claims = requireAuthClaims(c);
      let body: unknown;
      try {
        body = (await c.req.json()) as unknown;
      } catch (err) {
        void err;
        return c.json({ error: "invalid_request", message: "invalid json" }, 400);
      }
      const parsed = RevertRequest.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
      }
      const revision = await deps.policyBundleDal.revertToRevision({
        scope: scope.agentId
          ? { tenantId: scope.tenantId, scopeKind: "agent", agentId: scope.agentId }
          : { tenantId: scope.tenantId, scopeKind: "deployment" },
        revision: parsed.data.revision,
        createdBy: { kind: "tenant.token", token_id: claims.token_id },
        reason: parsed.data.reason,
      });
      return c.json(
        {
          revision: revision.revision,
          bundle: revision.bundle,
          agent_key: scope.agentKey ?? null,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? null,
          reverted_from_revision: revision.revertedFromRevision ?? null,
        },
        200,
      );
    });
  };

  registerPolicyRoutes(
    "/config/policy/deployment",
    async (c) => ({ tenantId: requireTenantId(c) }),
    async (c) => ({ tenantId: requireTenantId(c) }),
  );

  registerPolicyRoutes(
    "/config/policy/agents/:key",
    async (c) => {
      const tenantId = requireTenantId(c);
      const agentKey = normalizeAgentKey(c.req.param("key"));
      const agentId = await resolveExistingAgentId(deps, tenantId, agentKey);
      return agentId ? { tenantId, agentId, agentKey } : null;
    },
    async (c) => {
      const tenantId = requireTenantId(c);
      const agentKey = normalizeAgentKey(c.req.param("key"));
      const agentId = await resolveExistingAgentId(deps, tenantId, agentKey);
      if (!agentId) {
        return null;
      }
      const workspaceId = await deps.identityScopeDal.ensureWorkspaceId(
        tenantId,
        DEFAULT_WORKSPACE_KEY,
      );
      await deps.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
      return { tenantId, agentId, agentKey };
    },
  );
}

export function createGatewayConfigRoutes(deps: GatewayConfigRouteDeps): Hono {
  const app = new Hono();

  app.get("/config/hooks", async (c) => {
    const tenantId = requireTenantId(c);
    const revision = await deps.hooksDal.getLatest(tenantId);
    if (!revision) {
      return c.json(
        { revision: 0, hooks: [], created_at: null, created_by: null, reason: null },
        200,
      );
    }
    return c.json(
      {
        revision: revision.revision,
        hooks: revision.hooks,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  app.get("/config/hooks/revisions", async (c) => {
    const tenantId = requireTenantId(c);
    const revisions = await deps.hooksDal.listRevisions(tenantId);
    return c.json(
      {
        revisions: revisions.map((revision) => ({
          revision: revision.revision,
          hooks: revision.hooks,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? null,
          reverted_from_revision: revision.revertedFromRevision ?? null,
        })),
      },
      200,
    );
  });

  app.put("/config/hooks", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }
    const parsed = HooksUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const revision = await deps.hooksDal.set({
      tenantId,
      hooks: parsed.data.hooks,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    return c.json(
      {
        revision: revision.revision,
        hooks: revision.hooks,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  app.post("/config/hooks/revert", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }
    const parsed = RevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const revision = await deps.hooksDal.revertToRevision({
      tenantId,
      revision: parsed.data.revision,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    return c.json(
      {
        revision: revision.revision,
        hooks: revision.hooks,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  return app;
}

export function createPolicyConfigRoutes(deps: PolicyConfigRouteDeps): Hono {
  const app = new Hono();
  registerPolicyConfigRoutes(app, deps);
  return app;
}
