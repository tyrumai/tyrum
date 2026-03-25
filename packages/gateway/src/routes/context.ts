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
import { isToolAllowed } from "../app/modules/agent/tools.js";
import {
  resolveRequestedAgentKey,
  ScopeNotFoundError,
  type IdentityScopeDal,
} from "../app/modules/identity/scope.js";

export interface ContextRouteDeps {
  agents: AgentRegistry;
  contextReportDal: ContextReportDal;
  identityScopeDal: IdentityScopeDal;
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
    const sessionId = c.req.query("conversation_id")?.trim() || undefined;
    const runId = c.req.query("turn_id")?.trim() || undefined;
    const limitRaw = c.req.query("limit");
    const limit =
      typeof limitRaw === "string" && limitRaw.trim().length > 0
        ? Number.parseInt(limitRaw, 10)
        : undefined;

    const reports = await deps.contextReportDal.list({
      sessionId,
      runId,
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

    try {
      const registry = await runtime.listRegisteredTools();
      return c.json({
        status: "ok",
        allowlist: registry.allowlist,
        mcp_servers: registry.mcpServers,
        tools: registry.tools.map((tool) => ({
          id: tool.id,
          description: tool.description,
          source: tool.source ?? "builtin",
          family: tool.family ?? null,
          backing_server_id: tool.backingServerId ?? null,
          enabled_by_agent: isToolAllowed(registry.allowlist, tool.id),
        })),
      });
    } catch (err) {
      if (err instanceof ScopeNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      throw err;
    }
  });

  return app;
}
