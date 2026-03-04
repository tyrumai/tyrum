import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import { DateTimeSchema } from "@tyrum/schemas";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("RoutingConfigDal", () => {
  let db: SqliteDb;
  let dal: RoutingConfigDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new RoutingConfigDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("stores and returns routing config revisions with audit events", async () => {
    const created = await dal.set({
      config: {
        v: 1,
        telegram: {
          default_agent_key: "agent-a",
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

    const plan = await db.get<{ plan_id: string }>(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ?",
      [DEFAULT_TENANT_ID, "routing.config"],
    );
    expect(plan?.plan_id).toBeTruthy();

    const audit = await db.all<{ action: string }>(
      `SELECT action_json AS action
       FROM planner_events
       WHERE tenant_id = ? AND plan_id = ?
       ORDER BY step_index ASC`,
      [DEFAULT_TENANT_ID, plan?.plan_id ?? ""],
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

  it("normalizes sqlite routing config timestamps to ISO-8601", async () => {
    await db.run(
      "INSERT INTO routing_configs (config_json, created_by_json, reason) VALUES (?, ?, ?)",
      [JSON.stringify({ v: 1 }), "{}", "seed-default-time"],
    );

    const latest = await dal.getLatest();
    expect(latest).toBeDefined();
    expect(DateTimeSchema.safeParse(latest!.createdAt).success).toBe(true);
  });

  it("throws when a stored routing config revision is invalid", async () => {
    await db.run(
      "INSERT INTO routing_configs (config_json, created_by_json, reason) VALUES (?, ?, ?)",
      ["not-json", "{}", "corrupt"],
    );

    await expect(dal.getLatest()).rejects.toThrow();
  });

  it("reverts to an earlier revision by creating a new revision", async () => {
    const initial = await dal.set({
      config: {
        v: 1,
        telegram: {
          default_agent_key: "agent-a",
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
          default_agent_key: "agent-c",
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
    expect(reverted.revertedFromRevision).toBe(initial.revision);

    const plan = await db.get<{ plan_id: string }>(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ?",
      [DEFAULT_TENANT_ID, "routing.config"],
    );
    expect(plan?.plan_id).toBeTruthy();

    const audit = await db.all<{ action: string }>(
      `SELECT action_json AS action
       FROM planner_events
       WHERE tenant_id = ? AND plan_id = ?
       ORDER BY step_index ASC`,
      [DEFAULT_TENANT_ID, plan?.plan_id ?? ""],
    );
    expect(audit).toHaveLength(3);
    const revertAction = JSON.parse(audit[2]!.action) as Record<string, unknown>;
    expect(revertAction).toMatchObject({
      type: "routing.config.updated",
      revision: reverted.revision,
      reverted_from_revision: initial.revision,
    });
  });

  it("rolls back routing config insert if audit append fails", async () => {
    await db.exec("DROP TABLE planner_events");

    await expect(
      dal.set({
        config: { v: 1 },
        createdBy: { kind: "test" },
        reason: "should-fail",
        occurredAtIso: "2026-02-24T00:00:00.000Z",
      }),
    ).rejects.toThrow();

    const rows = await db.all<{ revision: number }>("SELECT revision FROM routing_configs");
    expect(rows).toHaveLength(0);
  });
});
