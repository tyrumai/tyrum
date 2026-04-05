import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
import { seedSnapshotApprovalScopeFixtures } from "../helpers/snapshot-fixtures.js";
import { DispatchRecordDal } from "../../src/modules/node/dispatch-record-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("snapshot routes approval scope import", () => {
  it("round-trips replacement scope records and drops legacy execution refs", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    const turnId = "550e8400-e29b-41d4-a716-446655440200";
    const turnItemId = "550e8400-e29b-41d4-a716-446655440201";
    const stepId = "550e8400-e29b-41d4-a716-446655440202";
    const attemptId = "550e8400-e29b-41d4-a716-446655440203";
    const workflowRunId = "550e8400-e29b-41d4-a716-446655440204";
    const workflowRunStepId = "550e8400-e29b-41d4-a716-446655440205";
    const dispatchId = "550e8400-e29b-41d4-a716-446655440206";
    await seedPausedExecutionRun({ db: container.db, jobId: "job-snapshot-linked", turnId });
    await seedSnapshotApprovalScopeFixtures({
      db: container.db,
      turnId,
      turnItemId,
      workflowRunId,
      workflowRunStepId,
    });
    await container.db.run(
      `INSERT INTO execution_steps (
         tenant_id,
         step_id,
         turn_id,
         step_index,
         status,
         action_json
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        stepId,
        turnId,
        0,
        "paused",
        JSON.stringify({ type: "CLI", args: { cmd: "echo", args: ["snapshot-linked"] } }),
      ],
    );
    await container.db.run(
      `INSERT INTO execution_attempts (
         tenant_id,
         attempt_id,
         step_id,
         attempt,
         status,
         metadata_json
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, attemptId, stepId, 1, "running", "{}"],
    );

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "snapshot-linked:0",
      prompt: "approve snapshot-linked run",
      motivation: "Snapshot import should preserve execution-linked approvals.",
      kind: "policy",
      turnId,
      turnItemId,
      workflowRunStepId,
      stepId,
      attemptId,
    });
    await container.db.run(
      `UPDATE execution_steps
       SET approval_id = ?
       WHERE tenant_id = ? AND step_id = ?`,
      [approval.approval_id, DEFAULT_TENANT_ID, stepId],
    );
    await new DispatchRecordDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      dispatchId,
      capability: "tyrum.desktop.snapshot",
      action: {
        type: "Desktop",
        args: { op: "snapshot", include_tree: true },
      },
      taskId: "task-snapshot-linked",
      turnId,
      turnItemId,
      workflowRunStepId,
      selectedNodeId: "node-snapshot-linked",
      connectionId: "conn-snapshot-linked",
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;
    const tables = bundle["tables"] as Record<string, unknown> | undefined;
    expect(tables).toBeDefined();
    expect(tables).toHaveProperty("turn_items");
    expect(tables).toHaveProperty("workflow_runs");
    expect(tables).toHaveProperty("workflow_run_steps");
    expect(tables).toHaveProperty("dispatch_records");
    expect(tables).not.toHaveProperty("execution_steps");
    expect(tables).not.toHaveProperty("execution_attempts");

    const { app: app2, container: container2 } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const importedApproval = await container2.db.get<{
      approval_id: string;
      turn_id: string | null;
      turn_item_id: string | null;
      workflow_run_step_id: string | null;
      step_id: string | null;
      attempt_id: string | null;
    }>(
      `SELECT approval_id, turn_id, turn_item_id, workflow_run_step_id, step_id, attempt_id
         FROM approvals
       WHERE approval_id = ?`,
      [approval.approval_id],
    );
    expect(importedApproval).toEqual({
      approval_id: approval.approval_id,
      turn_id: turnId,
      turn_item_id: turnItemId,
      workflow_run_step_id: workflowRunStepId,
      step_id: null,
      attempt_id: null,
    });

    const importedTurnItem = await container2.db.get<{ turn_item_id: string }>(
      `SELECT turn_item_id
       FROM turn_items
       WHERE tenant_id = ? AND turn_item_id = ?`,
      [DEFAULT_TENANT_ID, turnItemId],
    );
    expect(importedTurnItem).toEqual({ turn_item_id: turnItemId });

    const importedWorkflowStep = await container2.db.get<{ workflow_run_step_id: string }>(
      `SELECT workflow_run_step_id
       FROM workflow_run_steps
       WHERE tenant_id = ? AND workflow_run_step_id = ?`,
      [DEFAULT_TENANT_ID, workflowRunStepId],
    );
    expect(importedWorkflowStep).toEqual({ workflow_run_step_id: workflowRunStepId });

    await expect(
      new DispatchRecordDal(container2.db).getByDispatchId({
        tenantId: DEFAULT_TENANT_ID,
        dispatchId,
      }),
    ).resolves.toMatchObject({
      dispatch_id: dispatchId,
      turn_id: turnId,
      turn_item_id: turnItemId,
      workflow_run_step_id: workflowRunStepId,
      capability: "tyrum.desktop.snapshot",
      status: "dispatched",
      task_id: "task-snapshot-linked",
      selected_node_id: "node-snapshot-linked",
      connection_id: "conn-snapshot-linked",
      action: {
        type: "Desktop",
        args: { op: "snapshot", include_tree: true },
      },
    });

    await container.db.close();
    await container2.db.close();
  });
});
