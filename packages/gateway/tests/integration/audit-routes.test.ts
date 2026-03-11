import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { createAuditRoutes } from "../../src/routes/audit.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { PlanDal } from "../../src/modules/planner/plan-dal.js";

describe("Audit routes", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let eventLog: EventLog;
  let app: Hono;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    eventLog = new EventLog(db);
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route(
      "/",
      createAuditRoutes({
        db,
        eventLog,
        identityScopeDal: new IdentityScopeDal(db),
      }),
    );
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  async function appendEvents(planId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await eventLog.append({
        tenantId: DEFAULT_TENANT_ID,
        replayId: `r-${planId}-${String(i)}`,
        planKey: planId,
        stepIndex: i,
        occurredAt: `2025-01-15T10:0${String(i)}:00Z`,
        action: { step: i },
      });
    }
  }

  describe("GET /audit/export/:planKey", () => {
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
      expect(body.plan_id).toMatch(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/,
      );
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

  describe("GET /audit/plans", () => {
    it("lists recent audited plans in descending activity order and excludes empty plans", async () => {
      await appendEvents("plan-older", 1);
      await appendEvents("plan-newer", 2);
      await new PlanDal(db).ensurePlanId({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-empty",
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: "planner",
        status: "active",
      });

      const res = await app.request("/audit/plans?limit=10", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        plans: Array<{
          plan_key: string;
          event_count: number;
          last_event_at: string;
        }>;
      };

      expect(body.status).toBe("ok");
      expect(body.plans.map((plan) => plan.plan_key)).toEqual(["plan-newer", "plan-older"]);
      expect(body.plans[0]?.event_count).toBe(2);
      expect(body.plans[1]?.event_count).toBe(1);
      expect(body.plans.some((plan) => plan.plan_key === "plan-empty")).toBe(false);
    });

    it("clamps invalid limits to the recent-plan default window", async () => {
      await appendEvents("plan-1", 1);
      await appendEvents("plan-2", 1);

      const res = await app.request("/audit/plans?limit=0", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        plans: Array<{ plan_key: string }>;
      };
      expect(body.plans).toHaveLength(1);
      expect(["plan-1", "plan-2"]).toContain(body.plans[0]?.plan_key);
    });
  });

  describe("POST /audit/verify", () => {
    it("verifies a valid chain", async () => {
      await appendEvents("plan-1", 3);
      const events = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });

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
      const events = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
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
    it("requires an explicit confirm", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "delete",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("requires an explicit decision", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("deletes events and inserts a proof event for decision=delete", async () => {
      await appendEvents("plan-1", 3);
      const eventsBefore = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      const lastHashBefore = eventsBefore[eventsBefore.length - 1]!.event_hash;

      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "delete",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        decision: string;
        deleted_count: number;
        proof_event_id: number;
      };
      expect(body.decision).toBe("delete");
      expect(body.deleted_count).toBe(3);
      expect(body.proof_event_id).toBeGreaterThan(0);

      // Verify the proof event exists
      const remaining = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      expect(remaining).toHaveLength(1);

      const proofEvent = remaining[0]!;
      const action = JSON.parse(proofEvent.action) as {
        type: string;
        decision: string;
        entity_type: string;
        entity_id: string;
        deleted_count: number;
      };
      expect(action.type).toBe("forget.proof");
      expect(action.decision).toBe("delete");
      expect(action.entity_type).toBe("plan");
      expect(action.entity_id).toBe("plan-1");
      expect(action.deleted_count).toBe(3);

      // The proof event's prev_hash should link to the old chain
      expect(proofEvent.prev_hash).toBe(lastHashBefore);
      expect(proofEvent.event_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("allows verifying the original chain plus the delete proof event", async () => {
      await appendEvents("plan-1", 2);
      const eventsBefore = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });

      const forgetRes = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "delete",
        }),
      });
      expect(forgetRes.status).toBe(200);

      const remaining = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      expect(remaining).toHaveLength(1);

      const verifyRes = await app.request("/audit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [...eventsBefore, remaining[0]!] }),
      });
      expect(verifyRes.status).toBe(200);
      const body = (await verifyRes.json()) as { valid: boolean; checked_count: number };
      expect(body.valid).toBe(true);
      expect(body.checked_count).toBe(3);
    });

    it("deletes events and inserts a proof event for decision=anonymize", async () => {
      await appendEvents("plan-1", 2);

      const eventsBefore = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      const lastHashBefore = eventsBefore[eventsBefore.length - 1]!.event_hash;

      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "anonymize",
        }),
      });

      expect(res.status).toBe(200);
      const remaining = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      expect(remaining).toHaveLength(1);

      expect(remaining[0]!.prev_hash).toBe(lastHashBefore);
      expect(remaining[0]!.event_hash).toMatch(/^[0-9a-f]{64}$/);

      const action = JSON.parse(remaining[0]!.action) as { type: string; decision: string };
      expect(action.type).toBe("forget.proof");
      expect(action.decision).toBe("anonymize");
    });

    it("appends a proof event and leaves events intact for decision=retain", async () => {
      await appendEvents("plan-1", 2);
      const eventsBefore = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      const lastHashBefore = eventsBefore[eventsBefore.length - 1]!.event_hash;

      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "retain",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        decision: string;
        deleted_count: number;
        proof_event_id: number;
      };
      expect(body.decision).toBe("retain");
      expect(body.deleted_count).toBe(0);
      expect(body.proof_event_id).toBeGreaterThan(0);

      const eventsAfter = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-1",
      });
      expect(eventsAfter).toHaveLength(3);
      expect(eventsAfter[2]!.prev_hash).toBe(lastHashBefore);
      expect(eventsAfter[2]!.event_hash).toMatch(/^[0-9a-f]{64}$/);
      const action = JSON.parse(eventsAfter[2]!.action) as { type: string; decision: string };
      expect(action.type).toBe("forget.proof");
      expect(action.decision).toBe("retain");
    });

    it("inserts a proof event even when the target has no existing events", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "nonexistent",
          decision: "delete",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted_count: number; proof_event_id: number };
      expect(body.deleted_count).toBe(0);
      expect(body.proof_event_id).toBeGreaterThanOrEqual(0);

      const remaining = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "nonexistent",
      });
      expect(remaining).toHaveLength(1);
      const action = JSON.parse(remaining[0]!.action) as {
        type: string;
        decision: string;
        deleted_count: number;
      };
      expect(action.type).toBe("forget.proof");
      expect(action.decision).toBe("delete");
      expect(action.deleted_count).toBe(0);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/audit/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "FORGET", entity_type: "plan", decision: "delete" }),
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
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-1",
          decision: "delete",
        }),
      });

      // plan-2 should be untouched
      const plan2Events = await eventLog.getEventsForVerification({
        tenantId: DEFAULT_TENANT_ID,
        planKey: "plan-2",
      });
      expect(plan2Events).toHaveLength(2);
    });
  });
});
