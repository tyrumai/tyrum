import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("PolicyOverrideDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): PolicyOverrideDal {
    db = openTestSqliteDb();
    return new PolicyOverrideDal(db);
  }

  it("creates and retrieves an override", async () => {
    const dal = createDal();
    const row = await dal.create({
      agentId: "agent-1",
      toolId: "shell.exec",
      pattern: "/workspace/*",
    });

    expect(row.status).toBe("active");
    expect(row.agent_id).toBe("agent-1");
    expect(row.tool_id).toBe("shell.exec");
    expect(row.pattern).toBe("/workspace/*");

    const fetched = await dal.getById(row.policy_override_id);
    expect(fetched).toBeDefined();
    expect(fetched!.policy_override_id).toBe(row.policy_override_id);
  });

  it("lists active overrides for agent+tool", async () => {
    const dal = createDal();
    await dal.create({ agentId: "a1", toolId: "shell.exec", pattern: "*" });
    await dal.create({ agentId: "a1", toolId: "fs.write", pattern: "/tmp/*" });
    await dal.create({ agentId: "a2", toolId: "shell.exec", pattern: "*" });

    const a1Shell = await dal.listActive("a1", "shell.exec");
    expect(a1Shell).toHaveLength(1);

    const a1All = await dal.listActive("a1");
    expect(a1All).toHaveLength(2);
  });

  it("revokes an override", async () => {
    const dal = createDal();
    const row = await dal.create({ agentId: "a1", toolId: "t1", pattern: "*" });

    const ok = await dal.revoke(row.policy_override_id, "admin", "no longer needed");
    expect(ok).toBe(true);

    const after = await dal.getById(row.policy_override_id);
    expect(after!.status).toBe("revoked");
    expect(after!.revoked_by).toBe("admin");
    expect(after!.revoked_reason).toBe("no longer needed");

    // Revoked overrides don't appear in active list
    const active = await dal.listActive("a1");
    expect(active).toHaveLength(0);
  });

  it("expires stale overrides", async () => {
    const dal = createDal();
    // Create an override that expired 1 hour ago
    const pastIso = new Date(Date.now() - 3600_000).toISOString();
    await dal.create({ agentId: "a1", toolId: "t1", pattern: "*", expiresAt: pastIso });

    const expired = await dal.expireStale();
    expect(expired).toBe(1);

    const active = await dal.listActive("a1");
    expect(active).toHaveLength(0);
  });

  it("links override to approval_id", async () => {
    const dal = createDal();
    const row = await dal.create({
      agentId: "a1",
      toolId: "t1",
      pattern: "*",
      approvalId: 42,
      createdBy: "operator",
    });
    expect(row.created_from_approval_id).toBe(42);
    expect(row.created_by).toBe("operator");
  });

  it("links override to policy_snapshot_id", async () => {
    const dal = createDal();
    const snapshotId = randomUUID();
    const row = await dal.create({
      agentId: "a1",
      toolId: "t1",
      pattern: "*",
      policySnapshotId: snapshotId,
    });
    expect(row.created_from_policy_snapshot_id).toBe(snapshotId);
  });
});
