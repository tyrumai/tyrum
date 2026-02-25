/**
 * Audit routes — receipt bundle export, chain verification, and forget.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { EventLog } from "../modules/planner/event-log.js";
import {
  verifyChain,
  exportReceiptBundle,
  computeEventHash,
} from "../modules/audit/hash-chain.js";
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
      return c.json(
        { error: "not_found", message: `no events found for plan ${planId}` },
        404,
      );
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
      return c.json(
        { error: "invalid_request", message: "events array is required" },
        400,
      );
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
  // Find existing events for audit proof linking.
  const events = await deps.eventLog.getEventsForVerification(entityId);
  const lastEvent = events.length > 0 ? events[events.length - 1]! : undefined;
  const prevHash = lastEvent?.event_hash ?? null;
  const maxStepIndex = events.length > 0 ? Math.max(...events.map((e) => e.step_index)) : -1;
  const occurredAt = new Date().toISOString();

  if (decision === "retain") {
    const persisted = await deps.eventLog.appendNext({
      replayId: randomUUID(),
      planId: entityId,
      occurredAt,
      action: {
        type: "forget.proof",
        decision,
        entity_type: entityType,
        entity_id: entityId,
        deleted_count: 0,
      },
    });
    return { decision, deleted_count: 0, proof_event_id: persisted.id };
  }

  // Delete (or anonymize) the events from the table.
  const deletedCount = (await deps.db.run("DELETE FROM planner_events WHERE plan_id = ?", [entityId])).changes;

  // Insert a proof event that links to the prior chain head (if any).
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
      step_index: maxStepIndex + 1,
      occurred_at: occurredAt,
      action: proofAction,
    },
    prevHash,
  );

  const result = await deps.db.get<{ id: number }>(
    `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      `forget-${randomUUID()}`,
      entityId,
      maxStepIndex + 1,
      occurredAt,
      proofAction,
      prevHash,
      eventHash,
    ],
  );
  if (!result) {
    throw new Error("failed to insert forget proof event");
  }

  return {
    decision,
    deleted_count: deletedCount,
    proof_event_id: result.id,
  };
}
