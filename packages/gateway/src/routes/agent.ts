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
    const discoveredKeys = await opts.agents.listDiscoveredAgentKeys();
    const configsByAgentId = await listLatestAgentConfigsByAgentId(opts.db, tenantId);
    const agentByKey = new Map<
      string,
      {
        agent_key: string;
        agent_id?: string;
      }
    >(discovered.map((record) => [record.agent_key, record]));
    for (const agentKey of discoveredKeys) {
      agentByKey.set(agentKey, agentByKey.get(agentKey) ?? { agent_key: agentKey });
    }

    const agentRecords = await Promise.all(
      Array.from(agentByKey.values())
        .filter((record) => includeDefault || record.agent_key !== "default")
        .toSorted((left, right) => {
          if (left.agent_key === right.agent_key) return 0;
          if (left.agent_key === "default") return -1;
          if (right.agent_key === "default") return 1;
          return left.agent_key.localeCompare(right.agent_key);
        })
        .map(async (record) => {
          const config = record.agent_id ? configsByAgentId.get(record.agent_id) : undefined;
          const identity =
            !config?.persona && record.agent_id
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

          if (record.agent_id) {
            return {
              agent_key: record.agent_key,
              agent_id: record.agent_id,
              has_config: Boolean(config),
              persona,
            };
          }

          return {
            agent_key: record.agent_key,
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
