import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import { createTestContainer } from "./helpers.js";
import { seedExecutionScope, type ExecutionScopeIds } from "./execution-scope.js";

function stubMcpManager(): McpManager {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  } as unknown as McpManager;
}

describe("tool.node.dispatch desktop evidence artifacts", () => {
  let originalTyrumHome: string | undefined;
  let homeDir: string | undefined;
  let originalDesktopSandboxSensitivity: string | undefined;

  function createExecutor(
    container: Awaited<ReturnType<typeof createTestContainer>>,
    service: any,
  ) {
    return new ToolExecutor(
      homeDir!,
      stubMcpManager(),
      new Map(),
      fetch,
      undefined,
      undefined,
      container.redactionEngine,
      undefined,
      {
        db: container.db,
        workspaceId: "default",
        ownerPrefix: "test-tool",
      },
      service,
      container.artifactStore as any,
    );
  }

  beforeEach(async () => {
    originalTyrumHome = process.env["TYRUM_HOME"];
    originalDesktopSandboxSensitivity = process.env["TYRUM_DESKTOP_SANDBOX_ARTIFACT_SENSITIVITY"];
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-node-dispatch-"));
    process.env["TYRUM_HOME"] = homeDir;
  });

  afterEach(async () => {
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }

    if (originalDesktopSandboxSensitivity === undefined) {
      delete process.env["TYRUM_DESKTOP_SANDBOX_ARTIFACT_SENSITIVITY"];
    } else {
      process.env["TYRUM_DESKTOP_SANDBOX_ARTIFACT_SENSITIVITY"] = originalDesktopSandboxSensitivity;
    }
  });

  it("stores screenshot bytes as a run-scoped artifact and strips base64 from tool output", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-1",
      runId: "run-node-dispatch-1",
      stepId: "step-node-dispatch-1",
      attemptId: "attempt-node-dispatch-1",
    };
    await seedExecutionScope(container.db, scope);

    const pngBytes = Buffer.from("fake-png-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");

    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        return {
          taskId: "task-123",
          result: {
            ok: true,
            evidence: {
              type: "screenshot",
              mime: "image/png",
              width: 1,
              height: 1,
              timestamp: new Date().toISOString(),
              bytesBase64,
            },
          },
        };
      }),
    };

    const executor = createExecutor(container, nodeDispatchService as any);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-1",
      {
        capability: "tyrum.desktop",
        action: "Desktop",
        args: { op: "screenshot", display: "primary" },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("artifact://");
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const row = await container.db.get<{
      artifact_id: string;
      run_id: string | null;
      step_id: string | null;
      attempt_id: string | null;
      sensitivity: string;
      labels_json: string;
    }>(
      `SELECT artifact_id, run_id, step_id, attempt_id, sensitivity, labels_json
       FROM execution_artifacts
       WHERE run_id = ? AND step_id = ? AND kind = 'screenshot'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scope.runId, scope.stepId],
    );
    expect(row).toBeTruthy();
    expect(row?.attempt_id).toBe(scope.attemptId);
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain("desktop");

    const res = await app.request(`/runs/${scope.runId}/artifacts/${row!.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pngBytes);

    await container.db.close();
  });

  it("stores a11y tree JSON returned in Desktop result as a run-scoped artifact and strips it from tool output", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-3",
      runId: "run-node-dispatch-3",
      stepId: "step-node-dispatch-3",
      attemptId: "attempt-node-dispatch-3",
    };
    await seedExecutionScope(container.db, scope);

    const tree = {
      root: {
        role: "window",
        name: "root",
        states: [],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        actions: [],
        children: [],
      },
    };

    const pngBytes = Buffer.from("fake-snapshot-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");

    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        return {
          taskId: "task-789",
          result: {
            ok: true,
            result: {
              op: "snapshot",
              tree,
            },
            evidence: {
              type: "snapshot",
              mode: "hybrid",
              mime: "image/png",
              width: 1,
              height: 1,
              timestamp: new Date().toISOString(),
              bytesBase64,
            },
          },
        };
      }),
    };

    const executor = createExecutor(container, nodeDispatchService as any);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-3",
      {
        capability: "tyrum.desktop",
        action: "Desktop",
        args: { op: "snapshot", include_tree: true },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("artifact://");
    expect(result.output).toContain("tree_artifact");
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const row = await container.db.get<{
      artifact_id: string;
      kind: string;
      mime_type: string | null;
      sensitivity: string;
      labels_json: string;
    }>(
      `SELECT artifact_id, kind, mime_type, sensitivity, labels_json
       FROM execution_artifacts
       WHERE run_id = ? AND step_id = ? AND kind = 'dom_snapshot'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scope.runId, scope.stepId],
    );
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("dom_snapshot");
    expect(row?.mime_type).toBe("application/json");
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain("a11y-tree");

    const res = await app.request(`/runs/${scope.runId}/artifacts/${row!.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual(tree);

    await container.db.close();
  });

  it("stores a11y tree JSON as a run-scoped artifact and strips it from tool output", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-2",
      runId: "run-node-dispatch-2",
      stepId: "step-node-dispatch-2",
      attemptId: "attempt-node-dispatch-2",
    };
    await seedExecutionScope(container.db, scope);

    const tree = {
      root: {
        role: "window",
        name: "root",
        states: [],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        actions: [],
        children: [],
      },
    };

    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        return {
          taskId: "task-456",
          result: {
            ok: true,
            evidence: {
              type: "snapshot",
              mode: "a11y",
              timestamp: new Date().toISOString(),
              tree,
            },
          },
        };
      }),
    };

    const executor = createExecutor(container, nodeDispatchService as any);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-2",
      {
        capability: "tyrum.desktop",
        action: "Desktop",
        args: { op: "snapshot", include_tree: true },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("artifact://");
    expect(result.output).toContain("tree_artifact");
    expect(result.output).not.toContain('"tree":{');

    const row = await container.db.get<{
      artifact_id: string;
      kind: string;
      mime_type: string | null;
      sensitivity: string;
      labels_json: string;
    }>(
      `SELECT artifact_id, kind, mime_type, sensitivity, labels_json
       FROM execution_artifacts
       WHERE run_id = ? AND step_id = ? AND kind = 'dom_snapshot'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scope.runId, scope.stepId],
    );
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("dom_snapshot");
    expect(row?.mime_type).toBe("application/json");
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain("a11y-tree");

    const res = await app.request(`/runs/${scope.runId}/artifacts/${row!.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual(tree);

    await container.db.close();
  });

  it("defaults sandbox desktop evidence artifacts to normal sensitivity and allows env override", async () => {
    const container = await createTestContainer();

    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-4",
      runId: "run-node-dispatch-4",
      stepId: "step-node-dispatch-4",
      attemptId: "attempt-node-dispatch-4",
    };
    await seedExecutionScope(container.db, scope);

    const nodeId = "node-sandbox-1";
    await container.db.run("UPDATE execution_attempts SET metadata_json = ? WHERE attempt_id = ?", [
      JSON.stringify({
        executor: {
          kind: "node",
          node_id: nodeId,
          connection_id: "conn-1",
        },
      }),
      scope.attemptId,
    ]);
    await container.db.run(
      "INSERT INTO node_pairings (status, node_id, metadata_json) VALUES ('approved', ?, ?)",
      [nodeId, JSON.stringify({ mode: "desktop-sandbox" })],
    );

    const pngBytes = Buffer.from("fake-sandbox-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");

    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        return {
          taskId: "task-sandbox",
          result: {
            ok: true,
            evidence: {
              type: "screenshot",
              mime: "image/png",
              width: 1,
              height: 1,
              timestamp: new Date().toISOString(),
              bytesBase64,
            },
          },
        };
      }),
    };

    const executor = createExecutor(container, nodeDispatchService as any);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-4",
      {
        capability: "tyrum.desktop",
        action: "Desktop",
        args: { op: "screenshot", display: "primary" },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("artifact://");
    expect(result.output).not.toContain(bytesBase64);

    const row = await container.db.get<{ sensitivity: string }>(
      `SELECT sensitivity
       FROM execution_artifacts
       WHERE run_id = ? AND step_id = ? AND kind = 'screenshot'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scope.runId, scope.stepId],
    );
    expect(row).toBeTruthy();
    expect(row?.sensitivity).toBe("normal");

    process.env["TYRUM_DESKTOP_SANDBOX_ARTIFACT_SENSITIVITY"] = "sensitive";

    const result2 = await executor.execute(
      "tool.node.dispatch",
      "call-5",
      {
        capability: "tyrum.desktop",
        action: "Desktop",
        args: { op: "screenshot", display: "primary" },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result2.error).toBeUndefined();

    const row2 = await container.db.get<{ sensitivity: string }>(
      `SELECT sensitivity
       FROM execution_artifacts
       WHERE run_id = ? AND step_id = ? AND kind = 'screenshot'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scope.runId, scope.stepId],
    );
    expect(row2).toBeTruthy();
    expect(row2?.sensitivity).toBe("sensitive");

    await container.db.close();
  });
});
