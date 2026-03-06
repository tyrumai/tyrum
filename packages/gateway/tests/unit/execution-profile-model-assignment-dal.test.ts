import { describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { ExecutionProfileModelAssignmentDal } from "../../src/modules/models/execution-profile-model-assignment-dal.js";

describe("ExecutionProfileModelAssignmentDal", () => {
  it("writes assignments in an existing transaction without opening a nested transaction", async () => {
    const runs: Array<{ sql: string; params: readonly unknown[] }> = [];

    const txDb: SqlDb = {
      kind: "postgres",
      get: async () => undefined,
      all: async () => [],
      run: async (sql, params = []) => {
        runs.push({ sql, params });
        return { changes: 1 };
      },
      exec: async () => {},
      transaction: async () => {
        throw new Error("nested transaction should not be opened");
      },
      close: async () => {},
    };

    const dal = new ExecutionProfileModelAssignmentDal(txDb);
    await expect(
      dal.upsertManyTx({
        tenantId: "tenant-1",
        assignments: [
          {
            executionProfileId: "interaction",
            presetKey: "preset-a",
          },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.sql).toContain("INSERT INTO execution_profile_model_assignments");
    expect(runs[0]?.params.slice(0, 3)).toEqual(["tenant-1", "interaction", "preset-a"]);
  });
});
