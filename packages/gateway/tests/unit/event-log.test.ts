import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("EventLog", () => {
  let db: SqliteDb;
  let log: EventLog;

  beforeEach(() => {
    db = openTestSqliteDb();
    log = new EventLog(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("appends and retrieves an event", async () => {
    const outcome = await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research", args: { query: "test" } },
    });

    expect(outcome.kind).toBe("inserted");
    if (outcome.kind === "inserted") {
      expect(outcome.event.id).toBe(0);
      expect(outcome.event.replayId).toBe("replay-1");
      expect(outcome.event.tenantId).toBe(DEFAULT_TENANT_ID);
      expect(outcome.event.planKey).toBe("plan-1");
      expect(outcome.event.planId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(outcome.event.stepIndex).toBe(0);
      expect(outcome.event.action).toEqual({
        type: "Research",
        args: { query: "test" },
      });
    }
  });

  it("returns duplicate for same plan+step", async () => {
    await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });

    const outcome = await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });

    expect(outcome.kind).toBe("duplicate");
  });

  it("allows same step index for different plans", async () => {
    const outcome1 = await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });

    const outcome2 = await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-2",
      planKey: "plan-2",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });

    expect(outcome1.kind).toBe("inserted");
    expect(outcome2.kind).toBe("inserted");
  });

  it("retrieves events ordered by step_index", async () => {
    // Insert in reverse order to verify ordering
    await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 2,
      occurredAt: "2025-01-15T10:02:00Z",
      action: { step: 2 },
    });
    await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { step: 0 },
    });
    await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { step: 1 },
    });

    const events = await log.eventsForPlan({ tenantId: DEFAULT_TENANT_ID, planKey: "plan-1" });
    expect(events).toHaveLength(3);
    expect(events[0]!.stepIndex).toBe(0);
    expect(events[1]!.stepIndex).toBe(1);
    expect(events[2]!.stepIndex).toBe(2);
  });

  it("rejects negative step index", async () => {
    await expect(
      log.append({
        tenantId: DEFAULT_TENANT_ID,
        replayId: "replay-1",
        planKey: "plan-1",
        stepIndex: -1,
        occurredAt: "2025-01-15T10:00:00Z",
        action: {},
      }),
    ).rejects.toThrow("step_index must be non-negative");
  });

  it("returns empty array for unknown plan", async () => {
    const events = await log.eventsForPlan({ tenantId: DEFAULT_TENANT_ID, planKey: "nonexistent" });
    expect(events).toEqual([]);
  });

  it("round-trips complex action payloads", async () => {
    const complexAction = {
      type: "Web",
      args: {
        url: "https://example.com",
        selectors: { button: "#submit" },
        steps: [1, 2, 3],
      },
      postcondition: { expectedText: "Success" },
    };

    await log.append({
      tenantId: DEFAULT_TENANT_ID,
      replayId: "replay-1",
      planKey: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: complexAction,
    });

    const events = await log.eventsForPlan({ tenantId: DEFAULT_TENANT_ID, planKey: "plan-1" });
    expect(events[0]!.action).toEqual(complexAction);
  });
});
