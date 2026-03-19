import { afterEach, describe, expect, it } from "vitest";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("PolicyOverrideDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("treats malformed JSON columns as empty objects when reading overrides", async () => {
    db = openTestSqliteDb();
    const dal = new PolicyOverrideDal(db);

    await db.run(
      `INSERT INTO policy_overrides (
         tenant_id,
         policy_override_id,
         override_key,
         status,
         agent_id,
         workspace_id,
         tool_id,
         pattern,
         created_by_json,
         revoked_by_json,
         revoked_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, 'revoked', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000099",
        "override:malformed-json",
        DEFAULT_AGENT_ID,
        "bash",
        "echo hi",
        "{",
        "not-json",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ],
    );

    const row = await dal.getById({
      tenantId: DEFAULT_TENANT_ID,
      policyOverrideId: "00000000-0000-4000-8000-000000000099",
    });

    expect(row).toMatchObject({
      policy_override_id: "00000000-0000-4000-8000-000000000099",
      status: "revoked",
      created_by: {},
      revoked_by: {},
    });
  });

  it("normalizes legacy node dispatch capability patterns on create and read", async () => {
    db = openTestSqliteDb();
    const dal = new PolicyOverrideDal(db);

    const created = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      toolId: "tool.node.dispatch",
      pattern: "action:invoke;capability:tyrum.browser;mode:allow",
    });

    expect(created.pattern).toBe("action:invoke;capability:tyrum.browser.*;mode:allow");

    const listed = await dal.listActiveForTool({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      toolId: "tool.node.dispatch",
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.pattern).toBe("action:invoke;capability:tyrum.browser.*;mode:allow");
  });

  it("filters list results by status", async () => {
    db = openTestSqliteDb();
    const dal = new PolicyOverrideDal(db);

    const active = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      toolId: "bash",
      pattern: "echo active",
    });
    const revoked = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      toolId: "bash",
      pattern: "echo revoked",
    });
    await dal.revoke({
      tenantId: DEFAULT_TENANT_ID,
      policyOverrideId: revoked.policy_override_id,
      reason: "cleanup",
    });

    const rows = await dal.list({
      tenantId: DEFAULT_TENANT_ID,
      status: "revoked",
      limit: 500,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.policy_override_id).toBe(revoked.policy_override_id);
    expect(rows[0]?.status).toBe("revoked");
    expect(rows[0]?.policy_override_id).not.toBe(active.policy_override_id);
  });

  it("returns undefined when revoking a missing override", async () => {
    db = openTestSqliteDb();
    const dal = new PolicyOverrideDal(db);

    await expect(
      dal.revoke({
        tenantId: DEFAULT_TENANT_ID,
        policyOverrideId: "missing-override",
        reason: "missing",
      }),
    ).resolves.toBeUndefined();
  });
});
