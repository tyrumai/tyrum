/**
 * Audit routes — receipt bundle export, chain verification, and forget.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { EventLog } from "../modules/planner/event-log.js";
import { verifyChain, exportReceiptBundle, computeEventHash } from "../modules/audit/hash-chain.js";
import type { ChainableEvent } from "../modules/audit/hash-chain.js";
import type { SqlDb } from "../statestore/types.js";
import { AuditForgetRequest, type AuditForgetDecision } from "@tyrum/schemas";
import { DEFAULT_AGENT_KEY, DEFAULT_WORKSPACE_KEY } from "../modules/identity/scope.js";
import { PlanDal } from "../modules/planner/plan-dal.js";
import type { IdentityScopeDal } from "../modules/identity/scope.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface AuditRouteDeps {
  db: SqlDb;
  eventLog: EventLog;
  identityScopeDal: IdentityScopeDal;
}

export function createAuditRoutes(deps: AuditRouteDeps): Hono {
  const audit = new Hono();

  audit.get("/audit/plans", async (c) => {
    const tenantId = requireTenantId(c);
    const rawLimit = c.req.query("limit");
    const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const plans = await deps.eventLog.listRecentPlans({ tenantId, limit });
    return c.json({ status: "ok", plans });
  });

  /** Export a receipt bundle for a plan. */
  audit.get("/audit/export/:planKey", async (c) => {
    const tenantId = requireTenantId(c);
    const planKey = c.req.param("planKey");
    const events = await deps.eventLog.getEventsForVerification({
      tenantId,
      planKey,
    });

    if (events.length === 0) {
      return c.json({ error: "not_found", message: `no events found for plan ${planKey}` }, 404);
    }

    const first = events[0];
    if (!first) {
      return c.json({ error: "not_found", message: `no events found for plan ${planKey}` }, 404);
    }
    const bundle = exportReceiptBundle(first.plan_id, events);
    return c.json(bundle);
  });

  /** Verify a receipt bundle's chain integrity. */
  audit.post("/audit/verify", async (c) => {
    const body = (await c.req.json()) as {
      events?: ChainableEvent[];
    };

    if (!body.events || !Array.isArray(body.events)) {
      return c.json({ error: "invalid_request", message: "events array is required" }, 400);
    }

    const result = verifyChain(body.events);
    return c.json(result);
  });

  /** Forget (delete) events matching an entity, preserving chain continuity. */
  audit.post("/audit/forget", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    const parsed = AuditForgetRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const { entity_type, entity_id, decision } = parsed.data;

    const agentId = await deps.identityScopeDal.ensureAgentId(tenantId, DEFAULT_AGENT_KEY);
    const workspaceId = await deps.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await deps.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    // We treat entity_id as a plan_id for planner_events
    const result = await forgetEvents(
      deps,
      { tenantId, agentId, workspaceId },
      entity_type,
      entity_id,
      decision,
    );
    return c.json(result);
  });

  return audit;
}

async function forgetEvents(
  deps: AuditRouteDeps,
  scope: { tenantId: string; agentId: string; workspaceId: string },
  entityType: string,
  entityId: string,
  decision: AuditForgetDecision,
): Promise<{ decision: string; deleted_count: number; proof_event_id: number }> {
  const occurredAt = new Date().toISOString();

  return await deps.db.transaction(async (tx) => {
    const tenantId = scope.tenantId;
    const planKey = entityId;
    const planId = await new PlanDal(tx).ensurePlanId({
      tenantId,
      planKey,
      agentId: scope.agentId,
      workspaceId: scope.workspaceId,
      kind: "audit",
      status: "active",
    });

    if (tx.kind === "postgres") {
      // Serialize forget actions per plan without blocking other tenants/plans.
      await tx.get("SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_id = ? FOR UPDATE", [
        tenantId,
        planId,
      ]);
    }

    const lastRow = await tx.get<{ step_index: number; event_hash: string | null }>(
      `SELECT step_index, event_hash
       FROM planner_events
       WHERE tenant_id = ? AND plan_id = ?
       ORDER BY step_index DESC
       LIMIT 1`,
      [tenantId, planId],
    );
    const prevHash = lastRow?.event_hash ?? null;
    const stepIndex = (lastRow?.step_index ?? -1) + 1;
    if (stepIndex < 0) {
      throw new Error("planner_events step_index overflow");
    }

    const deletedCount =
      decision === "retain"
        ? 0
        : (
            await tx.run("DELETE FROM planner_events WHERE tenant_id = ? AND plan_id = ?", [
              tenantId,
              planId,
            ])
          ).changes;

    const proofAction = JSON.stringify({
      type: "forget.proof",
      decision,
      entity_type: entityType,
      entity_id: entityId,
      deleted_count: deletedCount,
    });

    const eventHash = computeEventHash(
      {
        plan_id: planId,
        step_index: stepIndex,
        occurred_at: occurredAt,
        action: proofAction,
      },
      prevHash,
    );

    const inserted = await tx.run(
      `INSERT INTO planner_events (
         tenant_id,
         plan_id,
         step_index,
         replay_id,
         occurred_at,
         action_json,
         prev_hash,
         event_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${tenantId}`,
        planId,
        stepIndex,
        `forget-${randomUUID()}`,
        occurredAt,
        proofAction,
        prevHash,
        eventHash,
      ],
    );
    if (inserted.changes !== 1) {
      throw new Error("failed to insert forget proof event");
    }

    return {
      decision,
      deleted_count: deletedCount,
      proof_event_id: stepIndex,
    };
  });
}
