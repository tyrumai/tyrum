import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { toApprovalContract } from "../../src/modules/approval/to-contract.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("approval kind normalization", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("preserves budget approvals in the public contract", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const row = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      kind: "budget",
      prompt: "Budget exceeded — continue?",
    });

    const contract = toApprovalContract(row);
    expect(contract?.kind).toBe("budget");
  });

  it("allows writing cancelled status in the database", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const row = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Cancel me",
    });

    await expect(
      db.run("UPDATE approvals SET status = 'cancelled' WHERE id = ?", [row.id]),
    ).resolves.toMatchObject({ changes: 1 });

    const updated = await approvalDal.getById(row.id);
    expect(updated?.status).toBe("cancelled");
  });
});
