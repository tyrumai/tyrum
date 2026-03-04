/**
 * Context routes — "what the model saw" metadata.
 *
 * Phase 1 implementation: expose only a last-known in-memory report from the
 * singleton AgentRuntime. This is intentionally metadata-only (no prompt text)
 * to minimize accidental leakage; durable per-run context reports are a later
 * milestone once execution engine APIs are the primary control plane.
 */

import { Hono } from "hono";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { ContextReportDal } from "../modules/context/report-dal.js";

export interface ContextRouteDeps {
  agents: AgentRegistry;
  contextReportDal: ContextReportDal;
}

export function createContextRoutes(deps: ContextRouteDeps): Hono {
  const app = new Hono();

  app.get("/context", async (c) => {
    const agentId = c.req.query("agent_id")?.trim() || "default";
    let runtime;
    try {
      runtime = await deps.agents.getRuntime(agentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const report = runtime.getLastContextReport() ?? null;
    return c.json({ status: "ok", report });
  });

  app.get("/context/list", async (c) => {
    const sessionId = c.req.query("session_id")?.trim() || undefined;
    const runId = c.req.query("run_id")?.trim() || undefined;
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

  return app;
}
