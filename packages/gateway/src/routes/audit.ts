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

export interface AuditRouteDeps {
  db: SqlDb;
  eventLog: EventLog;
}

export function createAuditRoutes(deps: AuditRouteDeps): Hono {
  const audit = new Hono();

  /** Export a receipt bundle for a plan. */
  audit.get("/audit/export/:planId", async (c) => {
    const planId = c.req.param("planId");
    const events = await deps.eventLog.getEventsForVerification(planId);

    if (events.length === 0) {
      return c.json({ error: "not_found", message: `no events found for plan ${planId}` }, 404);
    }

    const bundle = exportReceiptBundle(planId, events);
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
    const body = (await c.req.json()) as unknown;
    const parsed = AuditForgetRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const { entity_type, entity_id, decision } = parsed.data;

    // We treat entity_id as a plan_id for planner_events
    const result = await forgetEvents(deps, entity_type, entity_id, decision);
    return c.json(result);
  });

  return audit;
}

async function forgetEvents(
  deps: AuditRouteDeps,
  entityType: string,
  entityId: string,
  decision: AuditForgetDecision,
): Promise<{ decision: string; deleted_count: number; proof_event_id: number }> {
  const occurredAt = new Date().toISOString();

  return await deps.db.transaction(async (tx) => {
    if (tx.kind === "postgres") {
      // Prevent concurrent appends while we compute chain head, delete, and insert the proof event.
      await tx.exec("LOCK TABLE planner_events IN EXCLUSIVE MODE");
    }

    const lastRow = await tx.get<{ step_index: number; event_hash: string | null }>(
      "SELECT step_index, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index DESC LIMIT 1",
      [entityId],
    );
    const prevHash = lastRow?.event_hash ?? null;
    const stepIndex = (lastRow?.step_index ?? -1) + 1;
    if (stepIndex < 0) {
      throw new Error("planner_events step_index overflow");
    }

    const deletedCount =
      decision === "retain"
        ? 0
        : (await tx.run("DELETE FROM planner_events WHERE plan_id = ?", [entityId])).changes;

    const proofAction = JSON.stringify({
      type: "forget.proof",
      decision,
      entity_type: entityType,
      entity_id: entityId,
      deleted_count: deletedCount,
    });

    const eventHash = computeEventHash(
      {
        plan_id: entityId,
        step_index: stepIndex,
        occurred_at: occurredAt,
        action: proofAction,
      },
      prevHash,
    );

    const result = await tx.get<{ id: number }>(
      `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [`forget-${randomUUID()}`, entityId, stepIndex, occurredAt, proofAction, prevHash, eventHash],
    );
    if (!result) {
      throw new Error("failed to insert forget proof event");
    }

    return {
      decision,
      deleted_count: deletedCount,
      proof_event_id: result.id,
    };
  });
}
