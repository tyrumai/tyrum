import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionPrimitive } from "@tyrum/schemas";
import { createToolRunnerStepExecutor } from "../../src/modules/execution/toolrunner-step-executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const largeResultEntrypoint = join(__dirname, "../fixtures/toolrunner/emit-large-step-result.mjs");
const payloadEchoEntrypoint = join(__dirname, "../fixtures/toolrunner/emit-toolrunner-payload.mjs");

describe("ToolRunnerStepExecutor", () => {
  it("does not truncate valid large StepResult JSON over stdio transport", async () => {
    const executor = createToolRunnerStepExecutor({
      entrypoint: largeResultEntrypoint,
      env: {
        ...process.env,
        STEP_RESULT_BYTES: "300000",
      },
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: "echo",
        args: ["ignored"],
      },
    });

    const res = await executor.execute(action, "plan-large", 0, 2_000, {
      tenantId: "tenant-large",
      runId: "run-large",
      stepId: "step-large",
      attemptId: "attempt-large",
      approvalId: null,
      key: "agent:large",
      lane: "default",
      workspaceId: "workspace-large",
      policySnapshotId: null,
    });
    expect(res.success).toBe(true);
    const result = res.result as { stdout?: string };
    expect(result.stdout?.length).toBe(300000);
  });

  it("includes the full execution context in the toolrunner payload", async () => {
    const executor = createToolRunnerStepExecutor({
      entrypoint: payloadEchoEntrypoint,
      env: process.env,
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: "echo",
        args: ["ignored"],
      },
    });

    const res = await executor.execute(action, "plan-tenant", 3, 2_000, {
      tenantId: "tenant-123",
      runId: "run-123",
      stepId: "step-123",
      attemptId: "attempt-123",
      approvalId: null,
      key: "agent:test",
      lane: "default",
      workspaceId: "workspace-123",
      policySnapshotId: "policy-123",
    });

    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({
      tenant_id: "tenant-123",
      run_id: "run-123",
      step_id: "step-123",
      attempt_id: "attempt-123",
      approval_id: null,
      key: "agent:test",
      lane: "default",
      workspace_id: "workspace-123",
      policy_snapshot_id: "policy-123",
      plan_id: "plan-tenant",
      step_index: 3,
    });
  });
});
