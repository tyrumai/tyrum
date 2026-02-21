/**
 * Policy override REST routes.
 *
 * Provides CRUD for durable policy overrides (approve-always records).
 */

import { Hono } from "hono";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";
import type { EventPublisher } from "../modules/backplane/event-publisher.js";

export interface PolicyOverrideRouteDeps {
  policyOverrideDal: PolicyOverrideDal;
  eventPublisher?: EventPublisher;
}

export function createPolicyOverrideRoutes(deps: PolicyOverrideRouteDeps): Hono {
  const { policyOverrideDal } = deps;
  const app = new Hono();

  /** Create a new override. */
  app.post("/policy/overrides", async (c) => {
    const body = await c.req.json<{
      agent_id: string;
      tool_id: string;
      pattern: string;
      workspace_id?: string;
      created_by?: string;
      expires_at?: string;
    }>();
    if (!body.agent_id || !body.tool_id || !body.pattern) {
      return c.json({ error: "invalid_request", message: "agent_id, tool_id, and pattern are required" }, 400);
    }
    const row = await policyOverrideDal.create({
      agentId: body.agent_id,
      toolId: body.tool_id,
      pattern: body.pattern,
      workspaceId: body.workspace_id,
      createdBy: body.created_by,
      expiresAt: body.expires_at,
    });

    void deps.eventPublisher?.publish("policy_override.created", {
      policy_override_id: row.policy_override_id,
      agent_id: row.agent_id,
      tool_id: row.tool_id,
      pattern: row.pattern,
    }).catch(() => { /* best-effort */ });

    return c.json(row, 201);
  });

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

    void deps.eventPublisher?.publish("policy_override.revoked", {
      policy_override_id: c.req.param("id"),
    }).catch(() => { /* best-effort */ });

    return c.json(row);
  });

  return app;
}
