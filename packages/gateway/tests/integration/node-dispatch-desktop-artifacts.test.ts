import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  createNodeDispatchHarness,
  expectBinaryArtifactResponse,
  expectJsonArtifactResponse,
  findLatestArtifactId,
  parseTaggedToolOutput,
} from "./node-dispatch-desktop-artifacts.runtime-test-support.js";
import {
  seedExecutionScope,
  type ExecutionScopeIds,
  extractPayloadArtifactId,
} from "./node-dispatch-desktop-artifacts-test-support.js";

const NODE_ID = "node-1";
const EXECUTION_SCOPE = {
  tenantId: DEFAULT_TENANT_ID,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
  key: "agent:agent-1:thread:thread-1",
  lane: "main",
} as const;

describe("tool.node.dispatch desktop evidence artifacts", () => {
  let originalTyrumHome: string | undefined;
  let homeDir: string | undefined;

  beforeEach(async () => {
    originalTyrumHome = process.env["TYRUM_HOME"];
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
  });

  it("stores screenshot bytes as a run-scoped artifact and strips base64 from tool output", async () => {
    const pngBytes = Buffer.from("fake-png-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
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
      })),
    };
    const { app, container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId: NODE_ID,
      service: nodeDispatchService,
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-1",
      runId: "run-node-dispatch-1",
      stepId: "step-node-dispatch-1",
      attemptId: "attempt-node-dispatch-1",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-1",
      {
        node_id: NODE_ID,
        capability: "tyrum.desktop.screenshot",
        action_name: "screenshot",
        input: { display: "primary" },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const artifactId = extractPayloadArtifactId(result.output, "artifact");
    const row = await container.db.get<{
      artifact_id: string;
      sensitivity: string;
      labels_json: string;
      metadata_json: string;
    }>(
      `SELECT a.artifact_id, a.sensitivity, a.labels_json, a.metadata_json
       FROM artifacts a
       WHERE a.tenant_id = ?
         AND a.artifact_id = ?`,
      [DEFAULT_TENANT_ID, artifactId],
    );
    expect(row?.artifact_id).toBe(artifactId);
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain('"screenshot"');
    expect(row?.labels_json).toContain('"desktop"');
    expect(row?.metadata_json).toContain('"evidence_type":"screenshot"');
    expect(row?.metadata_json).toContain('"mime":"image/png"');
    await expectBinaryArtifactResponse(app, artifactId, "image/png", pngBytes);

    await container.db.close();
  });

  it("creates a synthetic execution scope for chat-style screenshot dispatch so artifacts are fetchable", async () => {
    const pngBytes = Buffer.from("synthetic-fake-png-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-synthetic-1",
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
      })),
    };
    const { app, container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId: NODE_ID,
      service: nodeDispatchService,
    });

    const result = await executor.execute("tool.node.dispatch", "call-synthetic-1", {
      node_id: NODE_ID,
      capability: "tyrum.desktop.screenshot",
      action_name: "screenshot",
      input: { display: "primary" },
    });

    expect(result.error).toBeUndefined();
    const parsed = parseTaggedToolOutput(result.output);
    const runId =
      typeof parsed["run_id"] === "string" && parsed["run_id"].trim().length > 0
        ? parsed["run_id"]
        : null;
    expect(runId).not.toBeNull();

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: runId!,
      parentKind: "execution_run",
      tenantId: DEFAULT_TENANT_ID,
    });
    await expectBinaryArtifactResponse(app, artifactId, "image/png", pngBytes);

    await container.db.close();
  });

  it("stores a11y tree JSON returned in Desktop result as a run-scoped artifact and strips it from tool output", async () => {
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
      dispatchAndWait: vi.fn(async () => ({
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
      })),
    };
    const { app, container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId: NODE_ID,
      service: nodeDispatchService,
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-3",
      runId: "run-node-dispatch-3",
      stepId: "step-node-dispatch-3",
      attemptId: "attempt-node-dispatch-3",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-3",
      {
        node_id: NODE_ID,
        capability: "tyrum.desktop.snapshot",
        action_name: "snapshot",
        input: { include_tree: true },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "dom_snapshot",
      parentId: scope.stepId,
      parentKind: "execution_step",
      tenantId: DEFAULT_TENANT_ID,
    });
    const row = await container.db.get<{
      artifact_id: string;
      kind: string;
      mime_type: string | null;
      sensitivity: string;
      labels_json: string;
    }>(
      `SELECT artifact_id, kind, mime_type, sensitivity, labels_json
       FROM artifacts
       WHERE artifact_id = ?`,
      [artifactId],
    );
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("dom_snapshot");
    expect(row?.mime_type).toBe("application/json");
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain("a11y-tree");
    await expectJsonArtifactResponse(app, artifactId, "application/json", tree);

    await container.db.close();
  });

  it("stores a11y tree JSON as a run-scoped artifact and strips it from tool output", async () => {
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
      dispatchAndWait: vi.fn(async () => ({
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
      })),
    };
    const { app, container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId: NODE_ID,
      service: nodeDispatchService,
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-2",
      runId: "run-node-dispatch-2",
      stepId: "step-node-dispatch-2",
      attemptId: "attempt-node-dispatch-2",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-2",
      {
        node_id: NODE_ID,
        capability: "tyrum.desktop.snapshot",
        action_name: "snapshot",
        input: { include_tree: true },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain('"tree":{');

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "dom_snapshot",
      parentId: scope.stepId,
      parentKind: "execution_step",
      tenantId: DEFAULT_TENANT_ID,
    });
    const row = await container.db.get<{
      artifact_id: string;
      kind: string;
      mime_type: string | null;
      sensitivity: string;
      labels_json: string;
    }>(
      `SELECT artifact_id, kind, mime_type, sensitivity, labels_json
       FROM artifacts
       WHERE artifact_id = ?`,
      [artifactId],
    );
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("dom_snapshot");
    expect(row?.mime_type).toBe("application/json");
    expect(row?.sensitivity).toBe("sensitive");
    expect(row?.labels_json).toContain("a11y-tree");
    await expectJsonArtifactResponse(app, artifactId, "application/json", tree);

    await container.db.close();
  });

  it("defaults sandbox desktop evidence artifacts to normal sensitivity", async () => {
    const nodeId = "node-sandbox-1";
    const pngBytes = Buffer.from("fake-sandbox-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
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
      })),
    };
    const { container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId,
      service: nodeDispatchService,
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-node-dispatch-4",
      runId: "run-node-dispatch-4",
      stepId: "step-node-dispatch-4",
      attemptId: "attempt-node-dispatch-4",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);
    await container.db.run(
      "UPDATE execution_attempts SET metadata_json = ? WHERE tenant_id = ? AND attempt_id = ?",
      [
        JSON.stringify({
          executor: {
            kind: "node",
            node_id: nodeId,
            connection_id: "conn-1",
          },
        }),
        DEFAULT_TENANT_ID,
        scope.attemptId,
      ],
    );
    await container.db.run(
      "INSERT INTO node_pairings (tenant_id, status, node_id, metadata_json, motivation) VALUES (?, 'approved', ?, ?, ?)",
      [
        DEFAULT_TENANT_ID,
        nodeId,
        JSON.stringify({ mode: "desktop-sandbox" }),
        "Desktop sandbox evidence access was approved for this node.",
      ],
    );

    const result = await executor.execute(
      "tool.node.dispatch",
      "call-4",
      {
        node_id: nodeId,
        capability: "tyrum.desktop.screenshot",
        action_name: "screenshot",
        input: { display: "primary" },
      },
      {
        execution_run_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain(bytesBase64);

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: scope.stepId,
      parentKind: "execution_step",
      tenantId: DEFAULT_TENANT_ID,
    });
    const row = await container.db.get<{ sensitivity: string }>(
      `SELECT sensitivity
       FROM artifacts
       WHERE artifact_id = ?`,
      [artifactId],
    );
    expect(row).toBeTruthy();
    expect(row?.sensitivity).toBe("normal");

    await container.db.close();
  });
});
