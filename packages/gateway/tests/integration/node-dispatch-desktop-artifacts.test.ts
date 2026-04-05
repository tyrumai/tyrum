import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";
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
  persistDispatchRecord,
} from "./node-dispatch-desktop-artifacts-test-support.js";

const NODE_ID = "node-1";
const EXECUTION_SCOPE = {
  tenantId: DEFAULT_TENANT_ID,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
  key: "agent:agent-1:thread:thread-1",
} as const;

describe("dedicated desktop tool evidence artifacts", () => {
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

  it("stores screenshot bytes as a turn-scoped artifact and strips base64 from tool output", async () => {
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
      jobId: "11111111-1111-4111-8111-111111111101",
      turnId: "11111111-1111-4111-8111-111111111102",
      stepId: "11111111-1111-4111-8111-111111111103",
      attemptId: "11111111-1111-4111-8111-111111111104",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.desktop.screenshot",
      "call-1",
      {
        node_id: NODE_ID,
        display: "primary",
      },
      {
        execution_turn_id: scope.turnId,
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

    const result = await executor.execute("tool.desktop.screenshot", "call-synthetic-1", {
      node_id: NODE_ID,
      display: "primary",
    });

    expect(result.error).toBeUndefined();
    const parsed = parseTaggedToolOutput(result.output);
    const turnId =
      typeof parsed["turn_id"] === "string" && parsed["turn_id"].trim().length > 0
        ? parsed["turn_id"]
        : null;
    expect(turnId).not.toBeNull();

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: turnId!,
      parentKind: "execution_run",
      tenantId: DEFAULT_TENANT_ID,
    });
    await expectBinaryArtifactResponse(app, artifactId, "image/png", pngBytes);

    await container.db.close();
  });

  it("stores a11y tree JSON returned in Desktop result as a turn-scoped artifact and strips it from tool output", async () => {
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
      jobId: "11111111-1111-4111-8111-111111111121",
      turnId: "11111111-1111-4111-8111-111111111122",
      stepId: "11111111-1111-4111-8111-111111111123",
      attemptId: "11111111-1111-4111-8111-111111111124",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.desktop.snapshot",
      "call-3",
      {
        node_id: NODE_ID,
        include_tree: true,
      },
      {
        execution_turn_id: scope.turnId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "dom_snapshot",
      parentId: scope.workflowRunStepId ?? scope.stepId,
      parentKind: "workflow_run_step",
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

  it("stores a11y tree JSON as a turn-scoped artifact and strips it from tool output", async () => {
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
      jobId: "11111111-1111-4111-8111-111111111111",
      turnId: "11111111-1111-4111-8111-111111111112",
      stepId: "11111111-1111-4111-8111-111111111113",
      attemptId: "11111111-1111-4111-8111-111111111114",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.desktop.snapshot",
      "call-2",
      {
        node_id: NODE_ID,
        include_tree: true,
      },
      {
        execution_turn_id: scope.turnId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain('"tree":{');

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "dom_snapshot",
      parentId: scope.workflowRunStepId ?? scope.stepId,
      parentKind: "workflow_run_step",
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
    const dispatchId = "11111111-1111-4111-8111-111111111135";
    const taskId = "task-sandbox";
    const pngBytes = Buffer.from("fake-sandbox-bytes", "utf8");
    const bytesBase64 = pngBytes.toString("base64");
    let dispatchDb: SqlDb | undefined;
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        await persistDispatchRecord(dispatchDb!, {
          tenantId: DEFAULT_TENANT_ID,
          dispatchId,
          taskId,
          turnId: scope.turnId,
          nodeId,
          capability: "tyrum.desktop.screenshot",
          action: {
            type: "Desktop",
            args: {
              op: "screenshot",
              display: "primary",
            },
          },
        });
        return {
          taskId,
          dispatchId,
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
    const scope: ExecutionScopeIds = {
      jobId: "11111111-1111-4111-8111-111111111131",
      turnId: "11111111-1111-4111-8111-111111111132",
      stepId: "11111111-1111-4111-8111-111111111133",
      attemptId: "11111111-1111-4111-8111-111111111134",
    };
    const { container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId,
      service: nodeDispatchService,
    });
    dispatchDb = container.db;
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);
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
      "tool.desktop.screenshot",
      "call-4",
      {
        node_id: nodeId,
        display: "primary",
      },
      {
        execution_turn_id: scope.turnId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain(bytesBase64);

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: scope.workflowRunStepId ?? scope.stepId,
      parentKind: "workflow_run_step",
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
