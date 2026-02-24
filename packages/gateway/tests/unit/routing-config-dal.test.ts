import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog } from "../../src/modules/planner/event-log.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";

describe("RoutingConfigDal", () => {
  let db: SqliteDb;
  let eventLog: EventLog;
  let dal: RoutingConfigDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    eventLog = new EventLog(db);
    dal = new RoutingConfigDal(db, { eventLog });
  });

  afterEach(async () => {
    await db.close();
  });

  it("stores and returns routing config revisions with audit events", async () => {
    const created = await dal.set({
      config: {
        v: 1,
        telegram: {
          default_agent_id: "agent-a",
          threads: {
            "123": "agent-b",
          },
        },
      },
      createdBy: { kind: "test" },
      reason: "seed",
      occurredAtIso: "2026-02-24T00:00:00.000Z",
    });

    expect(created.revision).toBeGreaterThan(0);
    expect(created.config.telegram?.threads?.["123"]).toBe("agent-b");

    const latest = await dal.getLatest();
    expect(latest?.revision).toBe(created.revision);
    expect(latest?.config).toEqual(created.config);

    const audit = await db.all<{ action: string }>(
      "SELECT action FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      ["routing.config"],
    );
    expect(audit).toHaveLength(1);
    const action = JSON.parse(audit[0]!.action) as Record<string, unknown>;
    expect(action).toMatchObject({
      type: "routing.config.updated",
      revision: created.revision,
      reason: "seed",
    });
    expect(action.config_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reverts to an earlier revision by creating a new revision", async () => {
    const initial = await dal.set({
      config: {
        v: 1,
        telegram: {
          default_agent_id: "agent-a",
          threads: {
            "123": "agent-b",
          },
        },
      },
      createdBy: { kind: "test" },
      reason: "v1",
      occurredAtIso: "2026-02-24T00:00:00.000Z",
    });

    const updated = await dal.set({
      config: {
        v: 1,
        telegram: {
          default_agent_id: "agent-c",
        },
      },
      createdBy: { kind: "test" },
      reason: "v2",
      occurredAtIso: "2026-02-24T00:01:00.000Z",
    });

    const reverted = await dal.revertToRevision({
      revision: initial.revision,
      createdBy: { kind: "test" },
      reason: "rollback",
      occurredAtIso: "2026-02-24T00:02:00.000Z",
    });

    expect(updated.revision).toBeGreaterThan(initial.revision);
    expect(reverted.revision).toBeGreaterThan(updated.revision);
    expect(reverted.config).toEqual(initial.config);
  });
});
