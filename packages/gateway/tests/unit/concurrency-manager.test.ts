import { afterEach, describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import type { StepExecutor } from "../../src/modules/execution/engine.js";
import {
  executeWithTimeout,
  releaseConversationAndWorkspaceLeasesTx,
  touchConversationLeaseTx,
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
      workspaceId: "default",
      policySnapshotId: null,
    });

    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("releases conversation and workspace leases in a transaction", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "worker-1", 123],
    );
    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "worker-1", 123],
    );

    await db.transaction(async (tx) => {
      await releaseConversationAndWorkspaceLeasesTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        key: "key-1",
        workspaceId: DEFAULT_WORKSPACE_ID,
        owner: "worker-1",
      });
    });

    const conversationLease = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversation_leases WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    const workspace = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workspace_leases WHERE tenant_id = ? AND workspace_id = ?",
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID],
    );

    expect(conversationLease?.n ?? 0).toBe(0);
    expect(workspace?.n ?? 0).toBe(0);
  });

  it("touches conversation leases by updating expires_at_ms", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
	       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "worker-1", 123],
    );

    await db.transaction(async (tx) => {
      await touchConversationLeaseTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        key: "key-1",
        owner: "worker-1",
        expiresAtMs: 456,
      });
    });

    const row = await db.get<{ lease_expires_at_ms: number }>(
      "SELECT lease_expires_at_ms FROM conversation_leases WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    expect(row?.lease_expires_at_ms).toBe(456);
  });
});
