import { Hono } from "hono";
import { requireTenantId } from "../app/modules/auth/claims.js";
import { ScopeNotFoundError } from "../app/modules/identity/scope.js";
import {
  LocationAutomationTriggerCreateRequest,
  LocationAutomationTriggerPatchRequest,
} from "../app/modules/location/types.js";
import { LocationService } from "../app/modules/location/service.js";

export function createAutomationTriggerRoutes(service: LocationService): Hono {
  const app = new Hono();

  app.get("/automation/triggers", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = c.req.query("agent_key")?.trim() || undefined;
    const workspaceKey = c.req.query("workspace_key")?.trim() || undefined;
    try {
      return c.json({
        status: "ok",
        triggers: await service.listAutomationTriggers({ tenantId, agentKey, workspaceKey }),
      });
    } catch (error) {
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      throw error;
    }
  });

  app.post("/automation/triggers", async (c) => {
    const tenantId = requireTenantId(c);
    const parsed = LocationAutomationTriggerCreateRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    try {
      const rawAgentKey = c.req.query("agent_key");
      if (rawAgentKey !== undefined && rawAgentKey.trim().length === 0) {
        return c.json(
          { error: "invalid_request", message: "agent_key must be a non-empty string" },
          400,
        );
      }
      const agentKey = await service.resolveAgentKey({ tenantId, agentKey: rawAgentKey });
      return c.json(
        {
          status: "ok",
          trigger: await service.createAutomationTrigger({ tenantId, agentKey, body: parsed.data }),
        },
        201,
      );
    } catch (error) {
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      throw error;
    }
  });

  app.patch("/automation/triggers/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const parsed = LocationAutomationTriggerPatchRequest.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const trigger = await service.updateAutomationTrigger({
      tenantId,
      triggerId: c.req.param("id"),
      patch: parsed.data,
    });
    if (!trigger) {
      return c.json({ error: "not_found", message: "trigger not found" }, 404);
    }
    return c.json({ status: "ok", trigger });
  });

  app.delete("/automation/triggers/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const deleted = await service.deleteAutomationTrigger({
      tenantId,
      triggerId: c.req.param("id"),
    });
    if (!deleted) {
      return c.json({ error: "not_found", message: "trigger not found" }, 404);
    }
    return c.json({ status: "ok", trigger_id: c.req.param("id"), deleted: true });
  });

  return app;
}
