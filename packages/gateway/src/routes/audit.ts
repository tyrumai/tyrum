/**
 * Audit routes — receipt bundle export, chain verification, and forget.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventLog } from "../modules/planner/event-log.js";
import {
  verifyChain,
  exportReceiptBundle,
  computeEventHash,
} from "../modules/audit/hash-chain.js";
import type { ChainableEvent } from "../modules/audit/hash-chain.js";

export interface AuditRouteDeps {
  db: Database.Database;
  eventLog: EventLog;
}

export function createAuditRoutes(deps: AuditRouteDeps): Hono {
  const audit = new Hono();

  /** Export a receipt bundle for a plan. */
  audit.get("/audit/export/:planId", (c) => {
    const planId = c.req.param("planId");
    const events = deps.eventLog.getEventsForVerification(planId);

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
    const body = (await c.req.json()) as {
      entity_type?: string;
      entity_id?: string;
    };

    if (!body.entity_type || !body.entity_id) {
      return c.json(
        {
          error: "invalid_request",
          message: "entity_type and entity_id are required",
        },
        400,
      );
    }

    const { entity_type, entity_id } = body;

    // We treat entity_id as a plan_id for planner_events
    const result = forgetEvents(deps, entity_type, entity_id);
    return c.json(result);
  });

  return audit;
}

function forgetEvents(
  deps: AuditRouteDeps,
  entityType: string,
  entityId: string,
): { deleted_count: number; deletion_event_id: number } {
  // Find events to delete
  const events = deps.eventLog.getEventsForVerification(entityId);

  if (events.length === 0) {
    return { deleted_count: 0, deletion_event_id: 0 };
  }

  // Get the last event's hash before deletion to maintain chain link
  const lastEvent = events[events.length - 1]!;
  const prevHash = lastEvent.event_hash;

  // Find the max step_index so the deletion event goes after all others
  const maxStepIndex = Math.max(...events.map((e) => e.step_index));

  // Delete the events from the table
  const deletedCount = deps.db
    .prepare("DELETE FROM planner_events WHERE plan_id = ?")
    .run(entityId).changes;

  // Insert a deletion event that links to the chain
  const deletionAction = JSON.stringify({
    type: "deletion",
    entity_type: entityType,
    entity_id: entityId,
    deleted_count: deletedCount,
    deleted_at: new Date().toISOString(),
  });

  const deletionStepIndex = maxStepIndex + 1;
  const occurredAt = new Date().toISOString();

  const eventHash = computeEventHash(
    {
      plan_id: entityId,
      step_index: deletionStepIndex,
      occurred_at: occurredAt,
      action: deletionAction,
    },
    prevHash,
  );

  const result = deps.db
    .prepare(
      `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `deletion-${randomUUID()}`,
      entityId,
      deletionStepIndex,
      occurredAt,
      deletionAction,
      prevHash,
      eventHash,
    );

  return {
    deleted_count: deletedCount,
    deletion_event_id: Number(result.lastInsertRowid),
  };
}
