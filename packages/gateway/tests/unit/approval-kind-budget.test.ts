import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { toApprovalContract } from "../../src/modules/approval/to-contract.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

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
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      kind: "budget",
      prompt: "Budget exceeded — continue?",
      motivation: "Budget approvals should round-trip through the public contract.",
    });

    const contract = toApprovalContract(row);
    expect(contract?.kind).toBe("budget");
  });

  it("restores scope key and lane from approval context", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const row = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      kind: "policy",
      prompt: "Restore scope metadata",
      motivation: "Context scope metadata should survive public serialization.",
      context: {
        key: "agent:default:main",
        lane: "main",
      },
    });

    const contract = toApprovalContract(row);
    expect(contract?.scope).toEqual({
      key: "agent:default:main",
      lane: "main",
    });
  });

  it("allows writing cancelled status in the database", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const row = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      kind: "policy",
      prompt: "Cancel me",
      motivation: "Cancelled approvals should remain writable in the database.",
    });

    await expect(
      db.run("UPDATE approvals SET status = 'cancelled' WHERE tenant_id = ? AND approval_id = ?", [
        DEFAULT_TENANT_ID,
        row.approval_id,
      ]),
    ).resolves.toMatchObject({ changes: 1 });

    const updated = await approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: row.approval_id,
    });
    expect(updated?.status).toBe("cancelled");
  });
});
