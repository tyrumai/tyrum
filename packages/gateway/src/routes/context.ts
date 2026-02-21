/**
 * Context report routes.
 *
 * Exposes persisted context reports for operator inspectability.
 */

import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import { ContextReportDal } from "../modules/observability/context-report-dal.js";

export interface ContextRouteOptions {
  db: SqlDb;
}

export function createContextRoutes(opts: ContextRouteOptions): Hono {
  const app = new Hono();
  const dal = new ContextReportDal(opts.db);

  app.get("/context", async (c) => {
    const sessionId = c.req.query("session_id")?.trim();
    const limitRaw = c.req.query("limit")?.trim();
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

    const reports = await dal.list({
      sessionId: sessionId && sessionId.length > 0 ? sessionId : undefined,
      limit,
    });

    return c.json({ reports });
  });

  app.get("/context/:id", async (c) => {
    const id = c.req.param("id");
    const report = await dal.getById(id);
    if (!report) {
      return c.json({ error: "not_found", message: `context report ${id} not found` }, 404);
    }
    return c.json(report);
  });

  // Convenience: fetch by plan id without requiring callers to know report_id.
  app.get("/context/by-plan/:planId", async (c) => {
    const planId = c.req.param("planId");
    const report = await dal.getByPlanId(planId);
    if (!report) {
      return c.json({ error: "not_found", message: `context report for plan ${planId} not found` }, 404);
    }
    return c.json(report);
  });

  return app;
}
