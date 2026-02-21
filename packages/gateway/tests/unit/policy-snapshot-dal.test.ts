import { afterEach, describe, expect, it } from "vitest";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("PolicySnapshotDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): PolicySnapshotDal {
    db = openTestSqliteDb();
    return new PolicySnapshotDal(db);
  }

  it("creates a snapshot and returns a row", async () => {
    const dal = createDal();
    const bundle = [
      {
        rules: [{ domain: "spend", action: "deny", priority: 1 }],
        precedence: "deployment",
      },
    ];

    const row = await dal.createSnapshot("run-1", bundle);

    expect(row.snapshot_id).toBeTruthy();
    expect(row.run_id).toBe("run-1");
    expect(row.created_at).toBeTruthy();

    const parsed = JSON.parse(row.bundle_json) as unknown;
    expect(parsed).toEqual(bundle);
  });

  it("retrieves snapshot by run_id", async () => {
    const dal = createDal();
    const bundle = { rules: [], precedence: "agent" };

    await dal.createSnapshot("run-42", bundle);
    const fetched = await dal.getByRunId("run-42");

    expect(fetched).toBeDefined();
    expect(fetched!.run_id).toBe("run-42");
    expect(JSON.parse(fetched!.bundle_json)).toEqual(bundle);
  });

  it("returns undefined for non-existent run_id", async () => {
    const dal = createDal();
    const result = await dal.getByRunId("no-such-run");
    expect(result).toBeUndefined();
  });

  it("retrieves snapshot by snapshot_id", async () => {
    const dal = createDal();
    const created = await dal.createSnapshot("run-99", { data: true });

    const fetched = await dal.getBySnapshotId(created.snapshot_id);
    expect(fetched).toBeDefined();
    expect(fetched!.run_id).toBe("run-99");
  });

  it("returns undefined for non-existent snapshot_id", async () => {
    const dal = createDal();
    const result = await dal.getBySnapshotId("no-such-id");
    expect(result).toBeUndefined();
  });

  it("stores multiple snapshots for different runs", async () => {
    const dal = createDal();

    await dal.createSnapshot("run-a", { a: 1 });
    await dal.createSnapshot("run-b", { b: 2 });

    const a = await dal.getByRunId("run-a");
    const b = await dal.getByRunId("run-b");

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(JSON.parse(a!.bundle_json)).toEqual({ a: 1 });
    expect(JSON.parse(b!.bundle_json)).toEqual({ b: 2 });
  });
});
