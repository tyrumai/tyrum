import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { verifyChain } from "../../src/modules/audit/hash-chain.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Audit hash chain integration", () => {
  let db: SqliteDb;
  let log: EventLog;

  beforeEach(() => {
    db = openTestSqliteDb();
    log = new EventLog(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("append 3 events and verify chain is valid", async () => {
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 2,
      occurredAt: "2025-01-15T10:02:00Z",
      action: { type: "Execute" },
    });

    const events = await log.getEventsForVerification("plan-1");
    expect(events).toHaveLength(3);

    const result = verifyChain(events);
    expect(result).toEqual({
      valid: true,
      checked_count: 3,
      broken_at_index: null,
      broken_at_id: null,
    });
  });

  it("detects tampered event in DB", async () => {
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "Research" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Decide" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 2,
      occurredAt: "2025-01-15T10:02:00Z",
      action: { type: "Execute" },
    });

    // Tamper with the action of the second event directly in DB
    await db.run(
      "UPDATE planner_events SET action = ? WHERE plan_id = ? AND step_index = 1",
      ['{"type":"Tampered"}', "plan-1"],
    );

    const events = await log.getEventsForVerification("plan-1");
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.broken_at_index).toBe(1);
  });

  it("handles mix of legacy (null hash) and new events", async () => {
    // Insert a legacy event directly (no hashes)
    await db.run(
      `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action)
       VALUES (?, ?, ?, ?, ?)`,
      ["r1", "plan-1", 0, "2025-01-15T10:00:00Z", '{"type":"Legacy"}'],
    );

    // Append new events via EventLog (will have hashes)
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "NewEvent1" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 2,
      occurredAt: "2025-01-15T10:02:00Z",
      action: { type: "NewEvent2" },
    });

    const events = await log.getEventsForVerification("plan-1");
    expect(events).toHaveLength(3);
    // Legacy event has null hashes
    expect(events[0]!.event_hash).toBeNull();
    // New events have hashes
    expect(events[1]!.event_hash).toBeTruthy();
    expect(events[2]!.event_hash).toBeTruthy();

    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.checked_count).toBe(2);
  });

  it("chains hashes correctly across events", async () => {
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 0,
      occurredAt: "2025-01-15T10:00:00Z",
      action: { type: "First" },
    });
    await log.append({
      replayId: "r1",
      planId: "plan-1",
      stepIndex: 1,
      occurredAt: "2025-01-15T10:01:00Z",
      action: { type: "Second" },
    });

    const events = await log.getEventsForVerification("plan-1");
    // First event's prev_hash should be null (no predecessor)
    expect(events[0]!.prev_hash).toBeNull();
    // Second event's prev_hash should be first event's event_hash
    expect(events[1]!.prev_hash).toBe(events[0]!.event_hash);
  });
});
