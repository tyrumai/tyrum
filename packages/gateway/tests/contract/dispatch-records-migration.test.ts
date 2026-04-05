import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ids } from "./fk-audit-contract.fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/161_dispatch_records.sql"),
  "utf8",
);

type DispatchReferenceColumn =
  | "turn_id"
  | "turn_item_id"
  | "workflow_run_step_id"
  | "policy_snapshot_id";

type DispatchRecordRow = {
  tenant_id: string;
  turn_id: string | null;
  turn_item_id: string | null;
  workflow_run_step_id: string | null;
  policy_snapshot_id: string | null;
};

type SqliteDeleteCase = {
  name: string;
  dispatchId: string;
  referenceColumn: DispatchReferenceColumn;
  setup: (db: SqlDb) => Promise<void>;
  deleteParent: (db: SqlDb) => Promise<void>;
};

async function seedIdentity(db: SqlDb): Promise<void> {
  await db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
    ids.tenantId,
    "dispatch-records-migration",
  ]);
  await db.run("INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)", [
    ids.tenantId,
    ids.agentId,
    "dispatch-records-agent",
  ]);
  await db.run("INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)", [
    ids.tenantId,
    ids.workspaceId,
    "dispatch-records-workspace",
  ]);
  await db.run(
    "INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)",
    [ids.tenantId, ids.agentId, ids.workspaceId],
  );
}

async function insertPolicySnapshot(db: SqlDb, policySnapshotId: string): Promise<void> {
  await db.run(
    `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
     VALUES (?, ?, ?, ?)`,
    [ids.tenantId, policySnapshotId, `sha:${policySnapshotId}`, "{}"],
  );
}

async function insertTurnItem(
  db: SqlDb,
  input: { turnId: string; turnItemId: string },
): Promise<void> {
  await db.run(
    `INSERT INTO turn_items (
       tenant_id,
       turn_item_id,
       turn_id,
       item_index,
       item_key,
       kind,
       payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      ids.tenantId,
      input.turnItemId,
      input.turnId,
      0,
      `message:${input.turnItemId}`,
      "message",
      "{}",
    ],
  );
}

async function insertWorkflowRunStep(
  db: SqlDb,
  input: {
    workflowRunId: string;
    workflowRunStepId: string;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO workflow_runs (
       workflow_run_id,
       tenant_id,
       agent_id,
       workspace_id,
       run_key,
       status,
       trigger_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.workflowRunId,
      ids.tenantId,
      ids.agentId,
      ids.workspaceId,
      `dispatch-records:${input.workflowRunId}`,
      "queued",
      "{}",
    ],
  );
  await db.run(
    `INSERT INTO workflow_run_steps (
       tenant_id,
       workflow_run_step_id,
       workflow_run_id,
       step_index,
       status,
       action_json
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ids.tenantId, input.workflowRunStepId, input.workflowRunId, 0, "queued", "{}"],
  );
}

async function insertDispatchRecord(
  db: SqlDb,
  input: {
    dispatchId: string;
    turnId?: string | null;
    turnItemId?: string | null;
    workflowRunStepId?: string | null;
    policySnapshotId?: string | null;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO dispatch_records (
       tenant_id,
       dispatch_id,
       turn_id,
       turn_item_id,
       workflow_run_step_id,
       capability,
       action_json,
       task_id,
       status,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ids.tenantId,
      input.dispatchId,
      input.turnId ?? null,
      input.turnItemId ?? null,
      input.workflowRunStepId ?? null,
      "tool.dispatch.records.test",
      "{}",
      `task:${input.dispatchId}`,
      "dispatched",
      input.policySnapshotId ?? null,
    ],
  );
}

const sqliteDeleteCases: SqliteDeleteCase[] = [
  {
    name: "turn rows",
    dispatchId: "20000000-0000-4000-8000-000000000001",
    referenceColumn: "turn_id",
    setup: async (db) => {
      await seedPausedExecutionRun({
        db,
        tenantId: ids.tenantId,
        agentId: ids.agentId,
        workspaceId: ids.workspaceId,
        jobId: "20000000-0000-4000-8000-000000000011",
        turnId: "20000000-0000-4000-8000-000000000012",
      });
      await insertDispatchRecord(db, {
        dispatchId: "20000000-0000-4000-8000-000000000001",
        turnId: "20000000-0000-4000-8000-000000000012",
      });
    },
    deleteParent: async (db) => {
      await db.run("DELETE FROM turns WHERE tenant_id = ? AND turn_id = ?", [
        ids.tenantId,
        "20000000-0000-4000-8000-000000000012",
      ]);
    },
  },
  {
    name: "turn item rows",
    dispatchId: "20000000-0000-4000-8000-000000000002",
    referenceColumn: "turn_item_id",
    setup: async (db) => {
      await seedPausedExecutionRun({
        db,
        tenantId: ids.tenantId,
        agentId: ids.agentId,
        workspaceId: ids.workspaceId,
        jobId: "20000000-0000-4000-8000-000000000021",
        turnId: "20000000-0000-4000-8000-000000000022",
      });
      await insertTurnItem(db, {
        turnId: "20000000-0000-4000-8000-000000000022",
        turnItemId: "20000000-0000-4000-8000-000000000023",
      });
      await insertDispatchRecord(db, {
        dispatchId: "20000000-0000-4000-8000-000000000002",
        turnItemId: "20000000-0000-4000-8000-000000000023",
      });
    },
    deleteParent: async (db) => {
      await db.run("DELETE FROM turn_items WHERE tenant_id = ? AND turn_item_id = ?", [
        ids.tenantId,
        "20000000-0000-4000-8000-000000000023",
      ]);
    },
  },
  {
    name: "workflow run step rows",
    dispatchId: "20000000-0000-4000-8000-000000000003",
    referenceColumn: "workflow_run_step_id",
    setup: async (db) => {
      await insertWorkflowRunStep(db, {
        workflowRunId: "20000000-0000-4000-8000-000000000031",
        workflowRunStepId: "20000000-0000-4000-8000-000000000032",
      });
      await insertDispatchRecord(db, {
        dispatchId: "20000000-0000-4000-8000-000000000003",
        workflowRunStepId: "20000000-0000-4000-8000-000000000032",
      });
    },
    deleteParent: async (db) => {
      await db.run(
        "DELETE FROM workflow_run_steps WHERE tenant_id = ? AND workflow_run_step_id = ?",
        [ids.tenantId, "20000000-0000-4000-8000-000000000032"],
      );
    },
  },
  {
    name: "policy snapshot rows",
    dispatchId: "20000000-0000-4000-8000-000000000004",
    referenceColumn: "policy_snapshot_id",
    setup: async (db) => {
      await insertPolicySnapshot(db, "20000000-0000-4000-8000-000000000041");
      await insertDispatchRecord(db, {
        dispatchId: "20000000-0000-4000-8000-000000000004",
        policySnapshotId: "20000000-0000-4000-8000-000000000041",
      });
    },
    deleteParent: async (db) => {
      await db.run("DELETE FROM policy_snapshots WHERE tenant_id = ? AND policy_snapshot_id = ?", [
        ids.tenantId,
        "20000000-0000-4000-8000-000000000041",
      ]);
    },
  },
];

describe("dispatch_records migrations", () => {
  it("uses column-scoped SET NULL in postgres for composite foreign keys", () => {
    expect(postgresMigrationSql).toContain(
      "REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL (turn_id)",
    );
    expect(postgresMigrationSql).toContain(
      "REFERENCES turn_items(tenant_id, turn_item_id) ON DELETE SET NULL (turn_item_id)",
    );
    expect(postgresMigrationSql).toContain(
      "REFERENCES workflow_run_steps(tenant_id, workflow_run_step_id) ON DELETE SET NULL (workflow_run_step_id)",
    );
    expect(postgresMigrationSql).toContain(
      "REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL (policy_snapshot_id)",
    );
  });

  it.each(sqliteDeleteCases)(
    "sqlite keeps tenant_id and clears only $name references",
    async (testCase) => {
      const db = openTestSqliteDb();
      try {
        await seedIdentity(db);
        await testCase.setup(db);
        await testCase.deleteParent(db);

        const row = await db.get<DispatchRecordRow>(
          `SELECT
             tenant_id,
             turn_id,
             turn_item_id,
             workflow_run_step_id,
             policy_snapshot_id
           FROM dispatch_records
           WHERE tenant_id = ? AND dispatch_id = ?`,
          [ids.tenantId, testCase.dispatchId],
        );

        expect(row).toBeDefined();
        expect(row?.tenant_id).toBe(ids.tenantId);
        expect(row?.[testCase.referenceColumn]).toBeNull();
      } finally {
        await db.close();
      }
    },
  );
});
