/**
 * Agent runtime routes.
 *
 * Exposes multi-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentTurnRequest } from "@tyrum/schemas";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../modules/auth/claims.js";

export function createAgentRoutes(opts: { agents: AgentRegistry; db: SqlDb }): Hono {
  const agent = new Hono();

  agent.get("/agent/list", async (c) => {
    const tenantId = requireTenantId(c);
    const includeDefaultRaw = c.req.query("include_default")?.trim().toLowerCase();
    const includeDefault =
      includeDefaultRaw === undefined ? true : !["0", "false", "no"].includes(includeDefaultRaw);

    const discovered = await opts.db.all<{
      agent_key: string;
      agent_id: string;
    }>(
      `SELECT agent_key, agent_id
       FROM agents
       WHERE tenant_id = ?
       ORDER BY CASE WHEN agent_key = 'default' THEN 0 ELSE 1 END, agent_key ASC`,
      [tenantId],
    );
    const agentRecords = discovered.filter(
      (record) => includeDefault || record.agent_key !== "default",
    );

    return c.json({ agents: agentRecords }, 200);
  });

  agent.get("/agent/status", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = c.req.query("agent_key")?.trim() || "default";
    let runtime;
    try {
      runtime = await opts.agents.getRuntime({ tenantId, agentKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const status = await runtime.status(true);
    return c.json(status);
  });

  agent.post("/agent/turn", async (c) => {
    const tenantId = requireTenantId(c);
    const body: unknown = await c.req.json();
    const parsed = AgentTurnRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    try {
      const agentId = parsed.data.agent_key ?? "default";
      let runtime;
      try {
        runtime = await opts.agents.getRuntime({ tenantId, agentKey: agentId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: "invalid_request", message }, 400);
      }
      const result = await runtime.turn(parsed.data);
      return c.json(result, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return c.json(
        {
          error: "agent_runtime_error",
          message,
        },
        502,
      );
    }
  });

  return agent;
}
