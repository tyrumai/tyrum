/**
 * Agent runtime routes.
 *
 * Exposes multi-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentListResponse, AgentTurnRequest } from "@tyrum/schemas";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../modules/auth/claims.js";
import { listLatestAgentConfigsByAgentId, resolveAgentPersona } from "../modules/agent/persona.js";
import { loadOptionalIdentity } from "../modules/agent/optional-identity.js";
import { ScopeNotFoundError } from "../modules/identity/scope.js";

async function resolveAgentRecord(
  db: SqlDb,
  tenantId: string,
  agentKey: string,
): Promise<{ agent_id: string; agent_key: string } | undefined> {
  return await db.get<{ agent_id: string; agent_key: string }>(
    `SELECT agent_id, agent_key
     FROM agents
     WHERE tenant_id = ? AND agent_key = ?
     LIMIT 1`,
    [tenantId, agentKey],
  );
}

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
    const configsByAgentId = await listLatestAgentConfigsByAgentId(opts.db, tenantId);

    const agentRecords = await Promise.all(
      discovered
        .filter((record) => includeDefault || record.agent_key !== "default")
        .map(async (record) => {
          const config = configsByAgentId.get(record.agent_id);
          const identity = !config?.persona
            ? await loadOptionalIdentity({
                db: opts.db,
                tenantId,
                agentId: record.agent_id,
              })
            : undefined;
          const persona = resolveAgentPersona({
            agentKey: record.agent_key,
            config,
            identity,
          });

          return {
            agent_key: record.agent_key,
            agent_id: record.agent_id,
            has_config: Boolean(config),
            persona,
          };
        }),
    );

    return c.json(AgentListResponse.parse({ agents: agentRecords }), 200);
  });

  agent.get("/agent/status", async (c) => {
    const tenantId = requireTenantId(c);
    const agentKey = c.req.query("agent_key")?.trim() || "default";
    const record = await resolveAgentRecord(opts.db, tenantId, agentKey);
    if (!record) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }
    let runtime;
    try {
      runtime = await opts.agents.getRuntime({ tenantId, agentKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    try {
      const status = await runtime.status(true);
      return c.json(status);
    } catch (err) {
      if (err instanceof ScopeNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      throw err;
    }
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
      const record = await resolveAgentRecord(opts.db, tenantId, agentId);
      if (!record) {
        return c.json({ error: "not_found", message: `agent '${agentId}' not found` }, 404);
      }
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
