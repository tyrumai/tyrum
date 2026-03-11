import { describe, expect, it } from "vitest";
import { createNodeDispatchStepExecutor } from "../../src/modules/execution/node-dispatch-step-executor.js";
import type { ArtifactStore } from "../../src/modules/artifact/store.js";
import type { NodeDispatchService } from "../../src/modules/agent/node-dispatch-service.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("NodeDispatchStepExecutor", () => {
  it("uses a Browser-specific fallback error message when node dispatch returns ok=false with no error", async () => {
    const artifactStore: ArtifactStore = {
      put: async (_input) => {
        throw new Error("unexpected put");
      },
      get: async (_artifactId) => null,
      delete: async (_artifactId) => {
        throw new Error("unexpected delete");
      },
    };

    const nodeDispatchService = {
      dispatchAndWait: async () => {
        return {
          taskId: "task-1",
          result: { ok: false, evidence: undefined, result: undefined, error: undefined },
        };
      },
    } as unknown as NodeDispatchService;

    const executor = createNodeDispatchStepExecutor({
      db: {} as unknown as SqlDb,
      artifactStore,
      nodeDispatchService,
      fallback: {
        execute: async () => ({ success: false, error: "fallback" }),
      },
    });

    const result = await executor.execute(
      { type: "Browser", args: { op: "geolocation.get" } },
      "plan-1",
      0,
      10_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "agent:agent-1:thread:thread-1",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Browser task failed");
  });

  it("routes IOS actions through node dispatch and uses an IOS-specific fallback error message", async () => {
    const artifactStore: ArtifactStore = {
      put: async (_input) => {
        throw new Error("unexpected put");
      },
      get: async (_artifactId) => null,
      delete: async (_artifactId) => {
        throw new Error("unexpected delete");
      },
    };

    const nodeDispatchService = {
      dispatchAndWait: async () => {
        return {
          taskId: "task-2",
          result: { ok: false, evidence: undefined, result: undefined, error: undefined },
        };
      },
    } as unknown as NodeDispatchService;

    const executor = createNodeDispatchStepExecutor({
      db: {} as unknown as SqlDb,
      artifactStore,
      nodeDispatchService,
      fallback: {
        execute: async () => ({ success: false, error: "fallback" }),
      },
    });

    const result = await executor.execute(
      { type: "IOS", args: { op: "location.get_current" } },
      "plan-1",
      0,
      10_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "agent:agent-1:thread:thread-1",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("IOS task failed");
  });
});
