/**
 * Agent config revision routes (tenant-scoped; DB-backed).
 *
 * These replace runtime reads from agent.yml.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  AgentConfigGetResponse,
  AgentConfigListResponse,
  AgentConfigUpdateRequest,
  AgentKey,
} from "@tyrum/schemas";
import type {
  AgentConfig,
  AgentConfigGetResponse as AgentConfigGetResponseT,
} from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { IdentityScopeDal } from "../modules/identity/scope.js";
import { requireAuthClaims, requireTenantId } from "../modules/auth/claims.js";
import { AgentAdminService } from "../modules/agent/admin-service.js";
import { AgentConfigDal } from "../modules/config/agent-config-dal.js";
import { resolveAgentPersona } from "../modules/agent/persona.js";
import type { GatewayStateMode } from "../modules/runtime-state/mode.js";

function normalizeAgentKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "default";
  const parsed = AgentKey.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`invalid agent_key '${trimmed}' (${parsed.error.message})`);
  }
  return parsed.data;
}

interface AgentConfigRevisionResponseInput {
  revision: number;
  tenantId: string;
  agentId: string;
  config: AgentConfig;
  configSha256: string;
  createdAt: string;
  createdBy: unknown;
  reason: string | null;
  revertedFromRevision: number | null;
}

function buildAgentConfigRevisionResponse(
  agentKey: string,
  revision: AgentConfigRevisionResponseInput,
): AgentConfigGetResponseT {
  return AgentConfigGetResponse.parse({
    revision: revision.revision,
    tenant_id: revision.tenantId,
    agent_id: revision.agentId,
    agent_key: agentKey,
    config: revision.config,
    persona: resolveAgentPersona({ agentKey, config: revision.config }),
    config_sha256: revision.configSha256,
    created_at: revision.createdAt,
    created_by: revision.createdBy,
    reason: revision.reason,
    reverted_from_revision: revision.revertedFromRevision,
  });
}

const AgentConfigRevertRequest = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export interface AgentConfigRouteDeps {
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  stateMode: GatewayStateMode;
}

export function createAgentConfigRoutes(deps: AgentConfigRouteDeps): Hono {
  const app = new Hono();
  const agentAdmin = new AgentAdminService(deps);

  app.get("/config/agents", async (c) => {
    const tenantId = requireTenantId(c);
    const agents = (await agentAdmin.list(tenantId)).map((agent) => ({
      agent_id: agent.agent_id,
      agent_key: agent.agent_key,
      created_at: agent.created_at,
      updated_at: agent.updated_at,
      has_config: agent.has_config,
      persona: agent.persona,
    }));

    return c.json(AgentConfigListResponse.parse({ agents }), 200);
  });

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

  app.get("/config/agents/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = normalizeAgentKey(c.req.param("key"));
    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }

    const revision = await new AgentConfigDal(deps.db).getLatest({ tenantId, agentId });
    if (!revision) {
      return c.json({ error: "not_found", message: "agent config not found" }, 404);
    }

    return c.json(
      buildAgentConfigRevisionResponse(agentKey, {
        revision: revision.revision,
        tenantId: revision.tenantId,
        agentId: revision.agentId,
        config: revision.config,
        configSha256: revision.configSha256,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        reason: revision.reason ?? null,
        revertedFromRevision: revision.revertedFromRevision ?? null,
      }),
      200,
    );
  });

  app.get("/config/agents/:key/revisions", async (c) => {
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

    const revisions = await new AgentConfigDal(deps.db).listRevisions({ tenantId, agentId, limit });
    const payload = revisions.map((rev) => ({
      revision: rev.revision,
      config_sha256: rev.configSha256,
      created_at: rev.createdAt,
      created_by: rev.createdBy,
      reason: rev.reason ?? null,
      reverted_from_revision: rev.revertedFromRevision ?? null,
    }));

    return c.json({ revisions: payload }, 200);
  });

  app.put("/config/agents/:key", async (c) => {
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

    const parsed = AgentConfigUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const agentId = await resolveAgentId(tenantId, agentKey);
    if (!agentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }

    const revision = await new AgentConfigDal(deps.db).set({
      tenantId,
      agentId,
      config: parsed.data.config,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });

    return c.json(
      buildAgentConfigRevisionResponse(agentKey, {
        revision: revision.revision,
        tenantId: revision.tenantId,
        agentId: revision.agentId,
        config: revision.config,
        configSha256: revision.configSha256,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        reason: revision.reason ?? null,
        revertedFromRevision: revision.revertedFromRevision ?? null,
      }),
      200,
    );
  });

  app.post("/config/agents/:key/revert", async (c) => {
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

    const parsed = AgentConfigRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revision = await new AgentConfigDal(deps.db).revertToRevision({
      tenantId,
      agentId,
      revision: parsed.data.revision,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });

    return c.json(
      buildAgentConfigRevisionResponse(agentKey, {
        revision: revision.revision,
        tenantId: revision.tenantId,
        agentId: revision.agentId,
        config: revision.config,
        configSha256: revision.configSha256,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        reason: revision.reason ?? null,
        revertedFromRevision: revision.revertedFromRevision ?? null,
      }),
      200,
    );
  });

  return app;
}
