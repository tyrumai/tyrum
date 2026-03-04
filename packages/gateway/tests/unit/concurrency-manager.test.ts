import { afterEach, describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import type { StepExecutor } from "../../src/modules/execution/engine.js";
import {
  executeWithTimeout,
  releaseLaneAndWorkspaceLeasesTx,
  touchLaneLeaseTx,
} from "../../src/modules/execution/engine/concurrency-manager.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("concurrency-manager", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns executor result on success", async () => {
    const action: ActionPrimitive = { type: "CLI", args: {} };
    const executor: StepExecutor = {
      execute: async () => ({ success: true, result: "ok" }),
    };

    const result = await executeWithTimeout(executor, action, "plan-1", 1, 10_000, {
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      approvalId: null,
      key: "agent:test",
      lane: "default",
      workspaceId: "default",
      policySnapshotId: null,
    });

    expect(result).toEqual({ success: true, result: "ok" });
  });

  it("normalizes thrown errors into a failure StepResult", async () => {
    const action: ActionPrimitive = { type: "CLI", args: {} };
    const executor: StepExecutor = {
      execute: async () => {
        throw new Error("boom");
      },
    };

    const result = await executeWithTimeout(executor, action, "plan-1", 1, 10_000, {
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      approvalId: null,
      key: "agent:test",
      lane: "default",
      workspaceId: "default",
      policySnapshotId: null,
    });

    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("releases lane and workspace leases in a transaction", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "default", "worker-1", 123],
    );
    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "worker-1", 123],
    );

    await db.transaction(async (tx) => {
      await releaseLaneAndWorkspaceLeasesTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        key: "key-1",
        lane: "default",
        workspaceId: DEFAULT_WORKSPACE_ID,
        owner: "worker-1",
      });
    });

    const lane = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_leases WHERE tenant_id = ? AND key = ? AND lane = ?",
      [DEFAULT_TENANT_ID, "key-1", "default"],
    );
    const workspace = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workspace_leases WHERE tenant_id = ? AND workspace_id = ?",
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID],
    );

    expect(lane?.n ?? 0).toBe(0);
    expect(workspace?.n ?? 0).toBe(0);
  });

  it("touches lane leases by updating expires_at_ms", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "default", "worker-1", 123],
    );

    await db.transaction(async (tx) => {
      await touchLaneLeaseTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        key: "key-1",
        lane: "default",
        owner: "worker-1",
        expiresAtMs: 456,
      });
    });

    const row = await db.get<{ lease_expires_at_ms: number }>(
      "SELECT lease_expires_at_ms FROM lane_leases WHERE tenant_id = ? AND key = ? AND lane = ?",
      [DEFAULT_TENANT_ID, "key-1", "default"],
    );
    expect(row?.lease_expires_at_ms).toBe(456);
  });
});
