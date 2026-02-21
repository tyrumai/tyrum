/**
 * Policy override REST routes.
 *
 * Provides CRUD for durable policy overrides (approve-always records).
 */

import { Hono } from "hono";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";

export interface PolicyOverrideRouteDeps {
  policyOverrideDal: PolicyOverrideDal;
}

export function createPolicyOverrideRoutes(deps: PolicyOverrideRouteDeps): Hono {
  const { policyOverrideDal } = deps;
  const app = new Hono();

  /** List overrides (optionally filter by agent_id). */
  app.get("/policy/overrides", async (c) => {
    const agentId = c.req.query("agent_id");
    const rows = agentId
      ? await policyOverrideDal.listAll(agentId)
      : await policyOverrideDal.listAll();
    return c.json({ overrides: rows });
  });

  /** Get a single override by id. */
  app.get("/policy/overrides/:id", async (c) => {
    const row = await policyOverrideDal.getById(c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(row);
  });

  /** Revoke an override. */
  app.post("/policy/overrides/:id/revoke", async (c) => {
    const body = await c.req.json<{ reason?: string; revoked_by?: string }>().catch(
      () => ({ reason: undefined, revoked_by: undefined }),
    );
    const ok = await policyOverrideDal.revoke(
      c.req.param("id"),
      body.revoked_by,
      body.reason,
    );
    if (!ok) return c.json({ error: "not_found_or_already_revoked" }, 404);
    const row = await policyOverrideDal.getById(c.req.param("id"));
    return c.json(row);
  });

  return app;
}
