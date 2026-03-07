import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { expect, it, vi } from "vitest";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { NodeDispatchService } from "../../src/modules/agent/node-dispatch-service.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createToolExecutor,
  requireHomeDir,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

const nodeDispatchArgs = {
  capability: "tyrum.desktop",
  action: "Desktop",
};

function createWorkspaceLease(db: ReturnType<typeof openTestSqliteDb>) {
  return {
    db,
    tenantId: DEFAULT_TENANT_ID,
    agentId: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
  };
}

function createConnectedDesktopDeps(overrides: Record<string, unknown> = {}) {
  const connectionManager = new ConnectionManager();
  const taskResults = new TaskResultRegistry();
  const nodeWs = { send: vi.fn(), on: vi.fn(), readyState: 1 } as never;

  connectionManager.addClient(nodeWs, ["desktop"], {
    id: "conn-1",
    role: "node",
    deviceId: "node-1",
    protocolRev: 2,
    authClaims: {
      token_kind: "device",
      token_id: "token-node-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "node",
      device_id: "node-1",
      scopes: ["*"],
    },
  });

  return {
    connectionManager,
    taskResults,
    ...overrides,
  };
}

async function executeNodeDispatch(
  home: HomeDirState,
  nodeDispatchService: object,
  args: Record<string, unknown> = nodeDispatchArgs,
) {
  const db = openTestSqliteDb();

  try {
    return await createToolExecutor({
      homeDir: requireHomeDir(home),
      workspaceLease: createWorkspaceLease(db),
      nodeDispatchService: nodeDispatchService as never,
    }).execute("tool.node.dispatch", "call-7", args);
  } finally {
    await db.close();
  }
}

export function registerToolExecutorNodeDispatchTests(home: HomeDirState): void {
  it("tool.node.dispatch returns configuration error when dispatch is unavailable", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.node.dispatch",
      "call-7",
      { capability: "screen", action: "capture" },
    );

    expect(result.error).toBe("node dispatch is not configured");
  });

  it("tool.node.dispatch delegates to node dispatch service and returns structured output", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-123",
        result: { ok: true, evidence: { foo: "bar" } },
      })),
    };

    const result = await executeNodeDispatch(home, nodeDispatchService, {
      ...nodeDispatchArgs,
      args: { x: 1 },
    });

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledOnce();
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain('"ok":true');
    expect(result.output).toContain('"task_id":"task-123"');
    expect(result.output).toContain('"foo":"bar"');
  });

  it("tool.node.dispatch returns a structured, retryable timeout error", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        throw new Error("task result timeout: task-123");
      }),
    };

    const result = await executeNodeDispatch(home, nodeDispatchService, {
      ...nodeDispatchArgs,
      args: { x: 1 },
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('"ok":false');
    expect(result.output).toContain('"code":"timeout"');
    expect(result.output).toContain('"retryable":true');
  });

  const structuredErrorCases = [
    {
      name: "tool.node.dispatch returns a structured no_capable_node error when no desktop node is connected",
      service: () =>
        new NodeDispatchService(
          {
            connectionManager: new ConnectionManager(),
            taskResults: new TaskResultRegistry(),
          } as never,
        ),
      expectedCode: "no_capable_node",
    },
    {
      name: "tool.node.dispatch returns a structured not_paired error when a desktop node is connected but not paired",
      service: () =>
        new NodeDispatchService(
          createConnectedDesktopDeps({
            nodePairingDal: {
              getByNodeId: vi.fn(async () => ({
                status: "pending",
                capability_allowlist: [],
              })),
            },
          }) as never,
        ),
      expectedCode: "not_paired",
    },
    {
      name: "tool.node.dispatch returns a structured policy_denied error when policy denies node dispatch",
      service: () =>
        new NodeDispatchService(
          createConnectedDesktopDeps({
            nodePairingDal: {
              getByNodeId: vi.fn(async () => ({
                status: "approved",
                capability_allowlist: [
                  {
                    id: descriptorIdForClientCapability("desktop"),
                    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                  },
                ],
              })),
            },
            policyService: {
              isEnabled: () => true,
              isObserveOnly: () => false,
              evaluateToolCall: vi.fn(async () => ({
                decision: "deny",
                policy_snapshot: { policy_snapshot_id: "snap-1" },
              })),
            },
          }) as never,
        ),
      expectedCode: "policy_denied",
    },
  ] as const;

  for (const testCase of structuredErrorCases) {
    it(testCase.name, async () => {
      const result = await executeNodeDispatch(home, testCase.service());

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"ok":false');
      expect(result.output).toContain(`"code":"${testCase.expectedCode}"`);
    });
  }

  it("tool.node.dispatch omits oversized evidence to keep output bounded", async () => {
    const huge = "a".repeat(100_000);
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-123",
        result: { ok: true, evidence: { blob: huge } },
      })),
    };

    const result = await executeNodeDispatch(home, nodeDispatchService);

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('"truncated":true');
    expect(result.output).toContain("evidence too large");
    expect(result.output).not.toContain(huge.slice(0, 200));
  });
}
