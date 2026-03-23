import { Hono } from "hono";
import { z } from "zod";
import { IdentityPack, McpServerSpec, PluginManifest, SkillManifest } from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import type { IdentityScopeDal } from "../app/modules/identity/scope.js";
import { requireAuthClaims, requireTenantId } from "../app/modules/auth/claims.js";
import { AgentConfigDal } from "../app/modules/config/agent-config-dal.js";
import { AgentIdentityDal } from "../app/modules/agent/identity-dal.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../app/modules/agent/persona.js";
import { touchAgentUpdatedAt } from "../app/modules/agent/updated-at.js";
import type { PluginCatalogProvider } from "../app/modules/plugins/catalog-provider.js";
import {
  RuntimePackageDal,
  type RuntimePackageKind,
  type RuntimePackageRevision,
} from "../app/modules/agent/runtime-package-dal.js";
import { missingRequiredManifestFields } from "../app/modules/plugins/validation.js";
import { normalizeAgentKey } from "./config-key-utils.js";

const runtimePackageKindSchema = z.enum(["skill", "mcp", "plugin"]);

const AgentIdentityUpdateRequest = z
  .object({
    identity: IdentityPack,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const RevisionRevertRequest = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const RuntimePackageUpdateRequest = z
  .object({
    package: z.unknown(),
    artifact_id: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

function parseRuntimePackageDocument(kind: RuntimePackageKind, value: unknown): unknown {
  if (kind === "skill") {
    return SkillManifest.parse(value);
  }
  if (kind === "mcp") {
    return McpServerSpec.parse(value);
  }

  const plugin = PluginManifest.parse(value);
  const missing = missingRequiredManifestFields(plugin as Record<string, unknown>);
  if (missing.length > 0) {
    throw new Error(`missing required plugin field(s): ${missing.join(", ")}`);
  }
  return plugin;
}

function packageRevisionResponse(revision: RuntimePackageRevision) {
  return {
    revision: revision.revision,
    tenant_id: revision.tenantId,
    kind: revision.packageKind,
    key: revision.packageKey,
    package: revision.packageData,
    artifact_id: revision.artifactId ?? null,
    enabled: revision.enabled,
    package_sha256: revision.packageSha256,
    created_at: revision.createdAt,
    created_by: revision.createdBy,
    reason: revision.reason ?? null,
    reverted_from_revision: revision.revertedFromRevision ?? null,
  };
}

export interface SharedStateConfigRouteDeps {
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  pluginCatalogProvider?: PluginCatalogProvider;
}

export function createSharedStateConfigRoutes(deps: SharedStateConfigRouteDeps): Hono {
  const app = new Hono();
  const identityDal = new AgentIdentityDal(deps.db);
  const runtimePackageDal = new RuntimePackageDal(deps.db);

  const resolveAgentId = async (tenantId: string, agentKey: string): Promise<string | null> => {
    const row = await deps.db.get<{ agent_id: string }>(
      `SELECT agent_id
       FROM agents
       WHERE tenant_id = ? AND agent_key = ?
       LIMIT 1`,
      [tenantId, agentKey],
    );
    return row?.agent_id ?? null;
  };

  app.get("/config/agents/:key/identity", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = normalizeAgentKey(c.req.param("key"));
    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }

    const revision = await identityDal.getLatest({ tenantId, agentId });
    if (!revision) {
      return c.json({ error: "not_found", message: "agent identity not found" }, 404);
    }

    return c.json(
      {
        revision: revision.revision,
        tenant_id: revision.tenantId,
        agent_id: revision.agentId,
        agent_key: agentKey,
        identity: revision.identity,
        identity_sha256: revision.identitySha256,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  app.get("/config/agents/:key/identity/revisions", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = normalizeAgentKey(c.req.param("key"));
    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }

    const limitRaw = c.req.query("limit");
    const limit =
      typeof limitRaw === "string" && /^[0-9]+$/.test(limitRaw.trim())
        ? Number(limitRaw)
        : undefined;

    const revisions = await identityDal.listRevisions({ tenantId, agentId, limit });
    return c.json(
      {
        revisions: revisions.map((revision) => ({
          revision: revision.revision,
          identity_sha256: revision.identitySha256,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? null,
          reverted_from_revision: revision.revertedFromRevision ?? null,
        })),
      },
      200,
    );
  });

  app.put("/config/agents/:key/identity", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const agentKey = normalizeAgentKey(c.req.param("key"));

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = AgentIdentityUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }
    const configRevision = await new AgentConfigDal(deps.db).getLatest({ tenantId, agentId });
    const persona = resolveAgentPersona({
      agentKey,
      config: configRevision?.config,
      identity: parsed.data.identity,
    });
    const effectiveIdentity = applyPersonaToIdentity(parsed.data.identity, persona);

    const revision = await identityDal.set({
      tenantId,
      agentId,
      identity: effectiveIdentity,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    await touchAgentUpdatedAt(deps.db, { tenantId, agentId });

    return c.json(
      {
        revision: revision.revision,
        tenant_id: revision.tenantId,
        agent_id: revision.agentId,
        agent_key: agentKey,
        identity: revision.identity,
        identity_sha256: revision.identitySha256,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  app.post("/config/agents/:key/identity/revert", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const agentKey = normalizeAgentKey(c.req.param("key"));
    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = RevisionRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revision = await identityDal.revertToRevision({
      tenantId,
      agentId,
      revision: parsed.data.revision,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    await touchAgentUpdatedAt(deps.db, { tenantId, agentId });

    return c.json(
      {
        revision: revision.revision,
        tenant_id: revision.tenantId,
        agent_id: revision.agentId,
        agent_key: agentKey,
        identity: revision.identity,
        identity_sha256: revision.identitySha256,
        created_at: revision.createdAt,
        created_by: revision.createdBy,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      },
      200,
    );
  });

  app.get("/config/runtime-packages", async (c) => {
    const tenantId = requireTenantId(c);
    const parsedKind = runtimePackageKindSchema.safeParse(c.req.query("kind"));
    if (!parsedKind.success) {
      return c.json(
        { error: "invalid_request", message: "kind must be skill, mcp, or plugin" },
        400,
      );
    }

    const revisions = await runtimePackageDal.listLatest({
      tenantId,
      packageKind: parsedKind.data,
    });
    return c.json({ packages: revisions.map(packageRevisionResponse) }, 200);
  });

  app.get("/config/runtime-packages/:kind/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const parsedKind = runtimePackageKindSchema.safeParse(c.req.param("kind"));
    if (!parsedKind.success) {
      return c.json({ error: "invalid_request", message: parsedKind.error.message }, 400);
    }
    const packageKey = c.req.param("key").trim();
    if (!packageKey) {
      return c.json({ error: "invalid_request", message: "package key is required" }, 400);
    }

    const revision = await runtimePackageDal.getLatest({
      tenantId,
      packageKind: parsedKind.data,
      packageKey,
    });
    if (!revision) {
      return c.json({ error: "not_found", message: "runtime package not found" }, 404);
    }

    return c.json(packageRevisionResponse(revision), 200);
  });

  app.get("/config/runtime-packages/:kind/:key/revisions", async (c) => {
    const tenantId = requireTenantId(c);
    const parsedKind = runtimePackageKindSchema.safeParse(c.req.param("kind"));
    if (!parsedKind.success) {
      return c.json({ error: "invalid_request", message: parsedKind.error.message }, 400);
    }
    const packageKey = c.req.param("key").trim();
    if (!packageKey) {
      return c.json({ error: "invalid_request", message: "package key is required" }, 400);
    }

    const limitRaw = c.req.query("limit");
    const limit =
      typeof limitRaw === "string" && /^[0-9]+$/.test(limitRaw.trim())
        ? Number(limitRaw)
        : undefined;

    const revisions = await runtimePackageDal.listRevisions({
      tenantId,
      packageKind: parsedKind.data,
      packageKey,
      limit,
    });
    return c.json({ revisions: revisions.map(packageRevisionResponse) }, 200);
  });

  app.put("/config/runtime-packages/:kind/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsedKind = runtimePackageKindSchema.safeParse(c.req.param("kind"));
    if (!parsedKind.success) {
      return c.json({ error: "invalid_request", message: parsedKind.error.message }, 400);
    }
    const packageKey = c.req.param("key").trim();
    if (!packageKey) {
      return c.json({ error: "invalid_request", message: "package key is required" }, 400);
    }

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = RuntimePackageUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    let packageDocument: unknown;
    try {
      packageDocument = parseRuntimePackageDocument(parsedKind.data, parsed.data.package);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

    const revision = await runtimePackageDal.set({
      tenantId,
      packageKind: parsedKind.data,
      packageKey,
      packageData: packageDocument,
      artifactId: parsed.data.artifact_id,
      enabled: parsed.data.enabled,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    if (parsedKind.data === "plugin") {
      await deps.pluginCatalogProvider?.invalidateTenantRegistry(tenantId);
    }

    return c.json(packageRevisionResponse(revision), 200);
  });

  app.post("/config/runtime-packages/:kind/:key/revert", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsedKind = runtimePackageKindSchema.safeParse(c.req.param("kind"));
    if (!parsedKind.success) {
      return c.json({ error: "invalid_request", message: parsedKind.error.message }, 400);
    }
    const packageKey = c.req.param("key").trim();
    if (!packageKey) {
      return c.json({ error: "invalid_request", message: "package key is required" }, 400);
    }

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = RevisionRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revision = await runtimePackageDal.revertToRevision({
      tenantId,
      packageKind: parsedKind.data,
      packageKey,
      revision: parsed.data.revision,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    if (parsedKind.data === "plugin") {
      await deps.pluginCatalogProvider?.invalidateTenantRegistry(tenantId);
    }

    return c.json(packageRevisionResponse(revision), 200);
  });

  return app;
}
