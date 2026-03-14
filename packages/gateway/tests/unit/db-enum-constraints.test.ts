import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("DB enum constraints", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function insertPlan(kind: string, status: string): Promise<void> {
    if (!db) throw new Error("test db not initialized");
    await db.run(
      `INSERT INTO plans (tenant_id, plan_id, plan_key, agent_id, workspace_id, kind, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        randomUUID(),
        `plan-${randomUUID()}`,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        kind,
        status,
      ],
    );
  }

  async function insertApproval(kind: string, status: string): Promise<void> {
    if (!db) throw new Error("test db not initialized");
    await db.run(
      `INSERT INTO approvals (
         tenant_id,
         approval_id,
         approval_key,
         agent_id,
         workspace_id,
         kind,
         status,
         prompt,
         motivation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        randomUUID(),
        `approval-${randomUUID()}`,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        kind,
        status,
        "test prompt",
        "test motivation",
      ],
    );
  }

  it("rejects invalid plans.kind values", async () => {
    db = openTestSqliteDb();
    await expect(insertPlan("not_a_kind", "active")).rejects.toThrow();
  });

  it("rejects invalid plans.status values", async () => {
    db = openTestSqliteDb();
    await expect(insertPlan("audit", "not_a_status")).rejects.toThrow();
  });

  it("rejects invalid approvals.kind values", async () => {
    db = openTestSqliteDb();
    await expect(insertApproval("not_a_kind", "queued")).rejects.toThrow();
  });

  it("rejects invalid approvals.status values", async () => {
    db = openTestSqliteDb();
    await expect(insertApproval("workflow_step", "not_a_status")).rejects.toThrow();
  });
});
