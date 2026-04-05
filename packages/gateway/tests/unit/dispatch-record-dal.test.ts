import { describe, expect, it } from "vitest";
import { DispatchRecordDal } from "../../src/modules/node/dispatch-record-dal.js";
import type { SqlDb } from "../../src/statestore/types.js";

function createPostgresRecordingDb() {
  const runs: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  const db: SqlDb = {
    kind: "postgres",
    async get() {
      throw new Error("unexpected get()");
    },
    async all() {
      throw new Error("unexpected all()");
    },
    async run(sql, params) {
      runs.push({ sql, params });
      return { changes: 1 };
    },
    async exec() {
      throw new Error("unexpected exec()");
    },
    async transaction(fn) {
      return await fn(this);
    },
    async close() {},
  };

  return { db, runs };
}

describe("DispatchRecordDal", () => {
  it("uses a postgres boolean param when preserving existing evidence", async () => {
    const { db, runs } = createPostgresRecordingDb();

    await new DispatchRecordDal(db).completeByTaskId({
      tenantId: "tenant-1",
      taskId: "task-1",
      ok: true,
      result: { ok: true },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.params?.[2]).toBe(true);
  });

  it("uses a postgres boolean param when replacing evidence", async () => {
    const { db, runs } = createPostgresRecordingDb();

    await new DispatchRecordDal(db).completeByTaskId({
      tenantId: "tenant-1",
      taskId: "task-1",
      ok: true,
      evidence: { stream: "chunk" },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.params?.[2]).toBe(false);
  });
});
