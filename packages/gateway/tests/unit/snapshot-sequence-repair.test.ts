import { describe, expect, it } from "vitest";
import { repairPostgresSequences } from "../../src/routes/snapshot-sequence-repair.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("repairPostgresSequences", () => {
  it("resets empty-table sequences to start at 1", async () => {
    const setvalCalls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

    const db: SqlDb = {
      kind: "postgres",
      async all(sql, params) {
        if (sql.includes("information_schema.columns")) {
          return [{ column_name: "id" }] as never;
        }
        throw new Error(`unexpected all() query: ${sql} params=${JSON.stringify(params)}`);
      },
      async get(sql, params) {
        if (sql.startsWith("SELECT MAX(")) {
          return { max: null } as never;
        }
        if (sql.includes("setval(")) {
          setvalCalls.push({ sql, params });
          return undefined;
        }
        throw new Error(`unexpected get() query: ${sql} params=${JSON.stringify(params)}`);
      },
      async run() {
        throw new Error("unexpected run()");
      },
      async exec() {
        throw new Error("unexpected exec()");
      },
      async transaction(fn) {
        return await fn(this);
      },
      async close() {},
    };

    await repairPostgresSequences(db, ["planner_events"]);

    expect(setvalCalls).toHaveLength(1);
    expect(setvalCalls[0]?.params).toEqual(["planner_events", "id", 1]);
    expect(setvalCalls[0]?.sql).toContain(", false)");
  });

  it("sets non-empty-table sequences to the max value", async () => {
    const setvalCalls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

    const db: SqlDb = {
      kind: "postgres",
      async all(sql, params) {
        if (sql.includes("information_schema.columns")) {
          return [{ column_name: "id" }] as never;
        }
        throw new Error(`unexpected all() query: ${sql} params=${JSON.stringify(params)}`);
      },
      async get(sql, params) {
        if (sql.startsWith("SELECT MAX(")) {
          return { max: 42 } as never;
        }
        if (sql.includes("setval(")) {
          setvalCalls.push({ sql, params });
          return undefined;
        }
        throw new Error(`unexpected get() query: ${sql} params=${JSON.stringify(params)}`);
      },
      async run() {
        throw new Error("unexpected run()");
      },
      async exec() {
        throw new Error("unexpected exec()");
      },
      async transaction(fn) {
        return await fn(this);
      },
      async close() {},
    };

    await repairPostgresSequences(db, ["planner_events"]);

    expect(setvalCalls).toHaveLength(1);
    expect(setvalCalls[0]?.params).toEqual(["planner_events", "id", 42]);
    expect(setvalCalls[0]?.sql).toContain(", true)");
  });
});
