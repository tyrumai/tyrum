/**
 * Agent runtime routes.
 *
 * Exposes multi-agent APIs for turn execution and status introspection.
 */

import { Hono } from "hono";
import { AgentListResponse, AgentTurnRequest } from "@tyrum/contracts";
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
): Promise<
  { agent_id: string; agent_key: string; is_primary: boolean | number | null } | undefined
> {
  return await db.get<{ agent_id: string; agent_key: string; is_primary: boolean | number | null }>(
    `SELECT agent_id, agent_key, is_primary
     FROM agents
     WHERE tenant_id = ? AND agent_key = ?
     LIMIT 1`,
    [tenantId, agentKey],
  );
}

async function resolvePrimaryAgentRecord(
  db: SqlDb,
  tenantId: string,
): Promise<
  { agent_id: string; agent_key: string; is_primary: boolean | number | null } | undefined
> {
  return await db.get<{ agent_id: string; agent_key: string; is_primary: boolean | number | null }>(
    `SELECT agent_id, agent_key, is_primary
     FROM agents
     WHERE tenant_id = ? AND is_primary = TRUE
     LIMIT 1`,
    [tenantId],
  );
}

async function resolveRequestedAgentRecord(
  db: SqlDb,
  tenantId: string,
  agentKey: string | undefined,
): Promise<
  { agent_id: string; agent_key: string; is_primary: boolean | number | null } | undefined
> {
  if (agentKey === undefined) {
    return await resolvePrimaryAgentRecord(db, tenantId);
  }
  const normalized = agentKey.trim();
  if (!normalized) {
    throw new Error("agent_key must be a non-empty string");
  }
  return await resolveAgentRecord(db, tenantId, normalized);
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
      is_primary: boolean | number | null;
    }>(
      `SELECT agent_key, agent_id, is_primary
       FROM agents
       WHERE tenant_id = ?
       ORDER BY is_primary DESC, agent_key ASC`,
      [tenantId],
    );
    const configsByAgentId = await listLatestAgentConfigsByAgentId(opts.db, tenantId);

    const agentRecords = await Promise.all(
      discovered
        .filter(
          (record) => includeDefault || !(record.is_primary === true || record.is_primary === 1),
        )
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
            is_primary: record.is_primary === true || record.is_primary === 1,
            persona,
          };
        }),
    );

    return c.json(AgentListResponse.parse({ agents: agentRecords }), 200);
  });

  agent.get("/agent/status", async (c) => {
    const tenantId = requireTenantId(c);
    let record;
    try {
      record = await resolveRequestedAgentRecord(opts.db, tenantId, c.req.query("agent_key"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    if (!record) {
      return c.json({ error: "not_found", message: "primary agent not found" }, 404);
    }
    let runtime;
    try {
      runtime = await opts.agents.getRuntime({ tenantId, agentKey: record.agent_key });
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
      const record = await resolveRequestedAgentRecord(opts.db, tenantId, parsed.data.agent_key);
      if (!record) {
        return c.json({ error: "not_found", message: "primary agent not found" }, 404);
      }
      let runtime;
      try {
        runtime = await opts.agents.getRuntime({ tenantId, agentKey: record.agent_key });
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
