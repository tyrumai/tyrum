import { Hono } from "hono";
import { ManagedAgentCreateRequest, ManagedAgentUpdateRequest } from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import type { IdentityScopeDal } from "../modules/identity/scope.js";
import { requireAuthClaims, requireTenantId } from "../modules/auth/claims.js";
import {
  AgentAdminService,
  AgentAlreadyExistsError,
  AgentDeleteConflictError,
} from "../modules/agent/admin-service.js";
import type { GatewayStateMode } from "../modules/runtime-state/mode.js";
import { normalizeAgentKey } from "./config-key-utils.js";
import type { Logger } from "../modules/observability/logger.js";
import type { PluginCatalogProvider } from "../modules/plugins/catalog-provider.js";
import type { PluginRegistry } from "../modules/plugins/registry.js";

export interface AgentsRouteDeps {
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  stateMode: GatewayStateMode;
  logger?: Logger;
  pluginCatalogProvider?: PluginCatalogProvider;
  plugins?: PluginRegistry;
}

export function createAgentsRoutes(deps: AgentsRouteDeps): Hono {
  const app = new Hono();
  const service = new AgentAdminService(deps);

  app.get("/agents", async (c) => {
    const tenantId = requireTenantId(c);
    const agents = await service.list(tenantId);
    return c.json({ agents }, 200);
  });

  app.post("/agents", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (error) {
      void error;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = ManagedAgentCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    try {
      const created = await service.create({
        tenantId,
        agentKey: parsed.data.agent_key,
        config: parsed.data.config,
        createdBy: { kind: "tenant.token", token_id: claims.token_id },
        reason: parsed.data.reason,
      });
      return c.json(created, 201);
    } catch (error) {
      if (error instanceof AgentAlreadyExistsError) {
        return c.json({ error: "conflict", message: error.message }, 409);
      }
      throw error;
    }
  });

  app.get("/agents/:key", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    try {
      agentKey = normalizeAgentKey(c.req.param("key"));
    } catch (error) {
      return c.json({ error: "invalid_request", message: toErrorMessage(error) }, 400);
    }
    const detail = await service.get(tenantId, agentKey);
    if (!detail) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }
    return c.json(detail, 200);
  });

  app.get("/agents/:key/capabilities", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    try {
      agentKey = normalizeAgentKey(c.req.param("key"));
    } catch (error) {
      return c.json({ error: "invalid_request", message: toErrorMessage(error) }, 400);
    }
    return c.json(await service.getCapabilities(tenantId, agentKey), 200);
  });

  app.put("/agents/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    let agentKey: string;
    try {
      agentKey = normalizeAgentKey(c.req.param("key"));
    } catch (error) {
      return c.json({ error: "invalid_request", message: toErrorMessage(error) }, 400);
    }

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (error) {
      void error;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = ManagedAgentUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await service.update({
      tenantId,
      agentKey,
      config: parsed.data.config,
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }
    return c.json(updated, 200);
  });

  app.delete("/agents/:key", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    try {
      agentKey = normalizeAgentKey(c.req.param("key"));
    } catch (error) {
      return c.json({ error: "invalid_request", message: toErrorMessage(error) }, 400);
    }

    try {
      const deleted = await service.delete({ tenantId, agentKey });
      if (!deleted) {
        return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
      }
      return c.json(deleted, 200);
    } catch (error) {
      if (error instanceof AgentDeleteConflictError) {
        return c.json({ error: "conflict", message: error.message }, 409);
      }
      throw error;
    }
  });

  return app;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "invalid request";
}
