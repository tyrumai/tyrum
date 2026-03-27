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

describe("dedicated desktop tool evidence artifacts a11y", () => {
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
            backend: {
              mode: "accessibility-api",
              permissions: [],
            },
            windows: [],
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
      jobId: "22222222-2222-4222-8222-222222222121",
      runId: "22222222-2222-4222-8222-222222222122",
      stepId: "22222222-2222-4222-8222-222222222123",
      attemptId: "22222222-2222-4222-8222-222222222124",
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
        execution_turn_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain(JSON.stringify(tree));
    expect(result.output).not.toContain("bytesBase64");
    expect(result.output).not.toContain(bytesBase64);

    const screenshotArtifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: scope.stepId,
      parentKind: "execution_step",
      tenantId: DEFAULT_TENANT_ID,
    });
    const jsonArtifactId = extractPayloadArtifactId(result.output, "tree_artifact");
    await expectBinaryArtifactResponse(app, screenshotArtifactId, "image/png", pngBytes);
    await expectJsonArtifactResponse(app, jsonArtifactId, "application/json", tree);

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
        taskId: "task-a11y-1",
        result: {
          ok: true,
          result: {
            op: "snapshot",
            backend: {
              mode: "accessibility-api",
              permissions: [],
            },
            windows: [],
            tree,
          },
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
      jobId: "22222222-2222-4222-8222-222222222131",
      runId: "22222222-2222-4222-8222-222222222132",
      stepId: "22222222-2222-4222-8222-222222222133",
      attemptId: "22222222-2222-4222-8222-222222222134",
    };
    await seedExecutionScope(container.db, scope, EXECUTION_SCOPE);

    const result = await executor.execute(
      "tool.desktop.snapshot",
      "call-a11y-1",
      {
        node_id: NODE_ID,
        include_tree: true,
      },
      {
        execution_turn_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain(JSON.stringify(tree));

    const jsonArtifactId = extractPayloadArtifactId(result.output, "tree_artifact");
    await expectJsonArtifactResponse(app, jsonArtifactId, "application/json", tree);

    await container.db.close();
  });

  it("defaults sandbox desktop evidence artifacts to normal sensitivity", async () => {
    const pngBytes = Buffer.from("sandbox-bytes", "utf8");
    const nodeId = "node-sandbox-1";
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-sandbox-sensitivity",
        result: {
          ok: true,
          evidence: {
            type: "screenshot",
            mime: "image/png",
            width: 1,
            height: 1,
            timestamp: new Date().toISOString(),
            bytesBase64: pngBytes.toString("base64"),
            sensitivity: undefined,
          },
        },
      })),
    };
    const { app, container, executor } = await createNodeDispatchHarness({
      homeDir: homeDir!,
      nodeId,
      service: nodeDispatchService,
    });
    const scope: ExecutionScopeIds = {
      jobId: "22222222-2222-4222-8222-222222222141",
      runId: "22222222-2222-4222-8222-222222222142",
      stepId: "22222222-2222-4222-8222-222222222143",
      attemptId: "22222222-2222-4222-8222-222222222144",
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
      "tool.desktop.screenshot",
      "call-sandbox-sensitivity",
      {
        node_id: nodeId,
        display: "primary",
      },
      {
        execution_turn_id: scope.runId,
        execution_step_id: scope.stepId,
      },
    );

    expect(result.error).toBeUndefined();
    const row = await container.db.get<{ sensitivity: string }>(
      `SELECT a.sensitivity
       FROM artifacts a
       INNER JOIN artifact_links l
         ON l.tenant_id = a.tenant_id
        AND l.artifact_id = a.artifact_id
        AND l.parent_kind = 'execution_step'
        AND l.parent_id = ?
       WHERE a.tenant_id = ?
         AND a.kind = 'screenshot'
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [scope.stepId, DEFAULT_TENANT_ID],
    );
    expect(row?.sensitivity).toBe("normal");

    const artifactId = await findLatestArtifactId(container.db, {
      kind: "screenshot",
      parentId: scope.stepId,
      parentKind: "execution_step",
      tenantId: DEFAULT_TENANT_ID,
    });
    await expectBinaryArtifactResponse(app, artifactId, "image/png", pngBytes);

    await container.db.close();
  });
});
