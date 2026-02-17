/**
 * Agent runtime routes.
 *
 * Exposes singleton-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentTurnRequest } from "@tyrum/schemas";
import type { GatewayContainer } from "../container.js";
import { AgentRuntime } from "../modules/agent/runtime.js";

export function createAgentRoutes(container: GatewayContainer, runtime?: AgentRuntime): Hono {
  const agent = new Hono();
  const runtimeInstance = runtime ?? new AgentRuntime({ container });

  agent.get("/agent/status", async (c) => {
    const status = await runtimeInstance.status(true);
    return c.json(status);
  });

  agent.post("/agent/turn", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = AgentTurnRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", message: parsed.error.message },
        400,
      );
    }

    try {
      const result = await runtimeInstance.turn(parsed.data);
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
