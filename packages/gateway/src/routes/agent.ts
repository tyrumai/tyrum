/**
 * Agent runtime routes.
 *
 * Exposes multi-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentKey, AgentTurnRequest } from "@tyrum/schemas";
import type { AgentRegistry } from "../modules/agent/registry.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { requireTenantId } from "../modules/auth/claims.js";

export function createAgentRoutes(agents: AgentRegistry): Hono {
  const agent = new Hono();

  agent.get("/agent/list", async (c) => {
    const includeDefaultRaw = c.req.query("include_default")?.trim().toLowerCase();
    const includeDefault =
      includeDefaultRaw === undefined ? true : !["0", "false", "no"].includes(includeDefaultRaw);

    const baseHome = agents.resolveAgentHome("default");
    const agentsDir = join(baseHome, "agents");

    let discovered: string[] = [];
    try {
      const entries = await readdir(agentsDir, { withFileTypes: true });
      discovered = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => name !== "default")
        .filter((name) => AgentKey.safeParse(name).success)
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code !== "ENOENT") throw err;
    }

    const agentKeys = includeDefault ? ["default", ...discovered] : discovered;

    return c.json({ agents: agentKeys.map((agent_key) => ({ agent_key })) }, 200);
  });

  agent.get("/agent/status", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = c.req.query("agent_key")?.trim() || "default";
    let runtime;
    try {
      runtime = await agents.getRuntime({ tenantId, agentKey });
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
        runtime = await agents.getRuntime({ tenantId, agentKey: agentId });
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
