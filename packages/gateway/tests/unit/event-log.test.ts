import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { EventLog } from "../../src/modules/planner/event-log.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

function setupDb(): Database.Database {
  const db = createDatabase(":memory:");
  migrate(db, migrationsDir);
  return db;
}

describe("EventLog", () => {
  let db: Database.Database;
  let log: EventLog;

  beforeEach(() => {
    db = setupDb();
    log = new EventLog(db);
  });

  it("appends and retrieves an event", () => {
    const outcome = log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research", args: { query: "test" } },
    });

    expect(outcome.kind).toBe("inserted");
    if (outcome.kind === "inserted") {
      expect(outcome.event.id).toBeGreaterThan(0);
      expect(outcome.event.replayId).toBe("replay-1");
      expect(outcome.event.planId).toBe("plan-1");
      expect(outcome.event.stepIndex).toBe(0);
      expect(outcome.event.action).toEqual({
        type: "Research",
        args: { query: "test" },
      });
    }
  });

  it("returns duplicate for same plan+step", () => {
    log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });

    const outcome = log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });

    expect(outcome.kind).toBe("duplicate");
  });

  it("allows same step index for different plans", () => {
    const outcome1 = log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });

    const outcome2 = log.append({
      replayId: "replay-2",
      planId: "plan-2",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });

    expect(outcome1.kind).toBe("inserted");
    expect(outcome2.kind).toBe("inserted");
  });

  it("retrieves events ordered by step_index", () => {
    // Insert in reverse order to verify ordering
    log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 2,
      occurredAt: "2025-01-15T10:02:00Z",
      action: { step: 2 },
    });
    log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { step: 0 },
    });
    log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { step: 1 },
    });

    const events = log.eventsForPlan("plan-1");
    expect(events).toHaveLength(3);
    expect(events[0]!.stepIndex).toBe(0);
    expect(events[1]!.stepIndex).toBe(1);
    expect(events[2]!.stepIndex).toBe(2);
  });

  it("rejects negative step index", () => {
    expect(() =>
      log.append({
        replayId: "replay-1",
        planId: "plan-1",
        stepIndex: -1,
        occurredAt: "2025-01-15T10:00:00Z",
        action: {},
      }),
    ).toThrow("step_index must be non-negative");
  });

  it("returns empty array for unknown plan", () => {
    const events = log.eventsForPlan("nonexistent");
    expect(events).toEqual([]);
  });

  it("round-trips complex action payloads", () => {
    const complexAction = {
      type: "Web",
      args: {
        url: "https://example.com",
        selectors: { button: "#submit" },
        steps: [1, 2, 3],
      },
      postcondition: { expectedText: "Success" },
    };

    log.append({
      replayId: "replay-1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: complexAction,
    });

    const events = log.eventsForPlan("plan-1");
    expect(events[0]!.action).toEqual(complexAction);
  });
});
