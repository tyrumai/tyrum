/**
 * Policy override management routes.
 *
 * Durable operator-created overrides that relax require_approval -> allow for matching tool actions.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { PolicyOverrideDal, PolicyOverrideStatus } from "../modules/policy-overrides/dal.js";
import { toSchemaPolicyOverride } from "../modules/policy-overrides/schema.js";
import type { Logger } from "../modules/observability/logger.js";
import type { WsEventPublisher } from "../modules/approval/apply.js";

const VALID_STATUSES = new Set<PolicyOverrideStatus>(["active", "revoked", "expired"]);

export function createPolicyOverrideRoutes(deps: {
  policyOverrideDal: PolicyOverrideDal;
  wsPublisher?: WsEventPublisher;
  logger?: Logger;
}): Hono {
  const app = new Hono();

  app.get("/policy/overrides", async (c) => {
    const agentId = c.req.query("agent_id")?.trim();
    const toolId = c.req.query("tool_id")?.trim();
    const statusRaw = c.req.query("status")?.trim();
    const status =
      statusRaw && VALID_STATUSES.has(statusRaw as PolicyOverrideStatus)
        ? (statusRaw as PolicyOverrideStatus)
        : statusRaw
          ? null
          : undefined;
    if (status === null) {
      return c.json({ error: "invalid_request", message: "invalid status" }, 400);
    }

    const overrides = await deps.policyOverrideDal.list({
      agentId: agentId && agentId.length > 0 ? agentId : undefined,
      toolId: toolId && toolId.length > 0 ? toolId : undefined,
      status: status,
      limit: 200,
    });
    return c.json({ overrides: overrides.map(toSchemaPolicyOverride) });
  });

  app.get("/policy/overrides/:id", async (c) => {
    const id = c.req.param("id")?.trim();
    if (!id) {
      return c.json({ error: "invalid_request", message: "invalid override id" }, 400);
    }
    const override = await deps.policyOverrideDal.getById(id);
    if (!override) {
      return c.json({ error: "not_found", message: "override not found" }, 404);
    }
    return c.json({ policy_override: toSchemaPolicyOverride(override) });
  });

  app.post("/policy/overrides/:id/revoke", async (c) => {
    const id = c.req.param("id")?.trim();
    if (!id) {
      return c.json({ error: "invalid_request", message: "invalid override id" }, 400);
    }

    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const reason = typeof record["reason"] === "string" ? record["reason"] : undefined;

    const revokedBy = {
      source: "http",
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const override = await deps.policyOverrideDal.revoke({
      policyOverrideId: id,
      revokedBy,
      revokedReason: reason,
    });
    if (!override) {
      return c.json({ error: "not_found", message: "override not found" }, 404);
    }

    if (deps.wsPublisher && override.status === "revoked") {
      const nowIso = new Date().toISOString();
      deps.wsPublisher.publish(
        {
          event_id: randomUUID(),
          type: "policy_override.revoked",
          occurred_at: nowIso,
          payload: { policy_override: toSchemaPolicyOverride(override) },
        },
        { targetRole: "client" },
      );
    }

    deps.logger?.info("policy_override.revoked", {
      policy_override_id: id,
      status: override.status,
      reason,
    });

    return c.json({ policy_override: toSchemaPolicyOverride(override) });
  });

  app.post("/policy/overrides/expire-stale", async (c) => {
    const expired = await deps.policyOverrideDal.expireStale();
    if (deps.wsPublisher && expired.length > 0) {
      const nowIso = new Date().toISOString();
      for (const row of expired) {
        deps.wsPublisher.publish(
          {
            event_id: randomUUID(),
            type: "policy_override.expired",
            occurred_at: nowIso,
            payload: { policy_override: toSchemaPolicyOverride(row) },
          },
          { targetRole: "client" },
        );
      }
    }
    return c.json({ expired: expired.map(toSchemaPolicyOverride) });
  });

  return app;
}

