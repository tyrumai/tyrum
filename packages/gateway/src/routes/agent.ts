/**
 * Agent runtime routes.
 *
 * Exposes multi-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentTurnRequest } from "@tyrum/schemas";
import type { AgentRegistry } from "../modules/agent/registry.js";

export function createAgentRoutes(agents: AgentRegistry): Hono {
  const agent = new Hono();

  agent.get("/agent/status", async (c) => {
    const agentId = c.req.query("agent_id")?.trim() || "default";
    let runtime;
    try {
      runtime = await agents.getRuntime(agentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const status = await runtime.status(true);
    return c.json(status);
  });

  agent.post("/agent/turn", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = AgentTurnRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    try {
      const agentId = parsed.data.agent_id ?? "default";
      let runtime;
      try {
        runtime = await agents.getRuntime(agentId);
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
