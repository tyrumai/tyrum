/**
 * Context routes — "what the model saw" metadata.
 *
 * Phase 1 implementation: expose only a last-known in-memory report from the
 * singleton AgentRuntime. This is intentionally metadata-only (no prompt text)
 * to minimize accidental leakage; durable per-run context reports are a later
 * milestone once execution engine APIs are the primary control plane.
 */

import { Hono } from "hono";
import type { AgentRegistry } from "../app/modules/agent/registry.js";
import type { ContextReportDal } from "../app/modules/context/report-dal.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import {
  resolveRequestedAgentKey,
  ScopeNotFoundError,
  type IdentityScopeDal,
} from "../app/modules/identity/scope.js";
import type { PluginCatalogProvider } from "../app/modules/plugins/catalog-provider.js";
import type { PluginRegistry } from "../app/modules/plugins/registry.js";
import {
  hasRuntimeToolInventoryCatalog,
  isInvalidRequestError,
  resolveInventoryToolEntries,
  resolvePluginRegistry,
  resolveRequestedExecutionProfile,
} from "./tool-registry.js";

export interface ContextRouteDeps {
  agents: AgentRegistry;
  contextReportDal: ContextReportDal;
  identityScopeDal: IdentityScopeDal;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
}

export function createContextRoutes(deps: ContextRouteDeps): Hono {
  const app = new Hono();

  app.get("/context", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    try {
      agentKey = await resolveRequestedAgentKey({
        identityScopeDal: deps.identityScopeDal,
        tenantId,
        agentKey: c.req.query("agent_key"),
      });
    } catch (err) {
      if (err instanceof ScopeNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    let runtime;
    try {
      runtime = await deps.agents.getRuntime({ tenantId, agentKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const report = runtime.getLastContextReport() ?? null;
    return c.json({ status: "ok", report });
  });

  app.get("/context/list", async (c) => {
    const conversationId = c.req.query("conversation_id")?.trim() || undefined;
    const turnId = c.req.query("turn_id")?.trim() || undefined;
    const limitRaw = c.req.query("limit");
    const limit =
      typeof limitRaw === "string" && limitRaw.trim().length > 0
        ? Number.parseInt(limitRaw, 10)
        : undefined;

    const reports = await deps.contextReportDal.list({
      conversationId,
      turnId,
      limit,
    });
    return c.json({ status: "ok", reports });
  });

  app.get("/context/detail/:id", async (c) => {
    const id = c.req.param("id");
    const row = await deps.contextReportDal.getById({ contextReportId: id });
    if (!row) {
      return c.json({ error: "not_found", message: `context report '${id}' not found` }, 404);
    }
    return c.json({ status: "ok", report: row });
  });

  app.get("/context/tools", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    let executionProfile: string;
    try {
      agentKey = await resolveRequestedAgentKey({
        identityScopeDal: deps.identityScopeDal,
        tenantId,
        agentKey: c.req.query("agent_key"),
      });
      executionProfile = resolveRequestedExecutionProfile(c.req.query("execution_profile"));
    } catch (err) {
      if (err instanceof ScopeNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    let runtime;
    try {
      runtime = await deps.agents.getRuntime({ tenantId, agentKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

    try {
      const catalog = await runtime.listRegisteredTools({ executionProfile });
      if (!hasRuntimeToolInventoryCatalog(catalog)) {
        throw new Error("runtime tool inventory is unavailable");
      }
      const pluginRegistry = await resolvePluginRegistry(deps, tenantId);
      const tools = resolveInventoryToolEntries({
        catalog,
        pluginRegistry,
        agentKey,
      });

      return c.json({ status: "ok", tools }, 200);
    } catch (err) {
      if (isInvalidRequestError(err)) {
        return c.json({ error: "invalid_request", message: err.message }, 400);
      }
      if (err instanceof ScopeNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "internal_error", message }, 500);
    }
  });

  return app;
}
