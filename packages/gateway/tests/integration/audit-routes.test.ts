import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { createAuditRoutes } from "../../src/routes/audit.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Audit routes", () => {
  let db: SqliteDb;
  let eventLog: EventLog;
  let app: Hono;

  beforeEach(() => {
    db = openTestSqliteDb();
    eventLog = new EventLog(db);
    app = new Hono();
    app.route("/", createAuditRoutes({ db, eventLog }));
  });

  afterEach(async () => {
    await db.close();
  });

  async function appendEvents(planId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await eventLog.append({
        replayId: `r-${planId}-${String(i)}`,
        planId,
        stepIndex: i,
        occurredAt: `2025-01-15T10:0${String(i)}:00Z`,
        action: { step: i },
      });
    }
  }

  describe("GET /audit/export/:planId", () => {
    it("exports a valid receipt bundle", async () => {
      await appendEvents("plan-1", 3);

      const res = await app.request("/audit/export/plan-1", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        plan_id: string;
        events: unknown[];
        chain_verification: { valid: boolean; checked_count: number };
        exported_at: string;
      };
      expect(body.plan_id).toBe("plan-1");
      expect(body.events).toHaveLength(3);
      expect(body.chain_verification.valid).toBe(true);
      expect(body.chain_verification.checked_count).toBe(3);
      expect(body.exported_at).toBeDefined();
    });

    it("returns 404 for unknown plan", async () => {
      const res = await app.request("/audit/export/nonexistent", {
        method: "GET",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /audit/verify", () => {
    it("verifies a valid chain", async () => {
      await appendEvents("plan-1", 3);
      const events = await eventLog.getEventsForVerification("plan-1");

      const res = await app.request("/audit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        valid: boolean;
        checked_count: number;
      };
      expect(body.valid).toBe(true);
      expect(body.checked_count).toBe(3);
    });

    it("detects tampered chain", async () => {
      await appendEvents("plan-1", 3);
      const events = await eventLog.getEventsForVerification("plan-1");
      events[1]!.action = '{"tampered":true}';

      const res = await app.request("/audit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        valid: boolean;
        broken_at_index: number;
      };
      expect(body.valid).toBe(false);
      expect(body.broken_at_index).toBe(1);
    });

    it("returns 400 for missing events", async () => {
      const res = await app.request("/audit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /audit/forget", () => {
    it("deletes events and inserts a deletion event", async () => {
      await appendEvents("plan-1", 3);

      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "plan",
          entity_id: "plan-1",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        deleted_count: number;
        deletion_event_id: number;
      };
      expect(body.deleted_count).toBe(3);
      expect(body.deletion_event_id).toBeGreaterThan(0);

      // Verify the deletion event exists
      const remaining = await eventLog.getEventsForVerification("plan-1");
      expect(remaining).toHaveLength(1);

      const deletionEvent = remaining[0]!;
      const action = JSON.parse(deletionEvent.action) as {
        type: string;
        entity_type: string;
        entity_id: string;
        deleted_count: number;
      };
      expect(action.type).toBe("deletion");
      expect(action.entity_type).toBe("plan");
      expect(action.entity_id).toBe("plan-1");
      expect(action.deleted_count).toBe(3);
    });

    it("deletion event has valid hash chain", async () => {
      await appendEvents("plan-1", 2);

      // Get the last event's hash before forget
      const eventsBefore = await eventLog.getEventsForVerification("plan-1");
      const lastHashBefore = eventsBefore[eventsBefore.length - 1]!.event_hash;

      await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "plan",
          entity_id: "plan-1",
        }),
      });

      const remaining = await eventLog.getEventsForVerification("plan-1");
      expect(remaining).toHaveLength(1);

      // The deletion event's prev_hash should link to the old chain
      expect(remaining[0]!.prev_hash).toBe(lastHashBefore);
      // Its own hash should be valid
      expect(remaining[0]!.event_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns zero for nonexistent entity", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "plan",
          entity_id: "nonexistent",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted_count: number };
      expect(body.deleted_count).toBe(0);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "plan" }),
      });

      expect(res.status).toBe(400);
    });

    it("does not affect other plans", async () => {
      await appendEvents("plan-1", 2);
      await appendEvents("plan-2", 2);

      await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "plan",
          entity_id: "plan-1",
        }),
      });

      // plan-2 should be untouched
      const plan2Events = await eventLog.getEventsForVerification("plan-2");
      expect(plan2Events).toHaveLength(2);
    });
  });
});
