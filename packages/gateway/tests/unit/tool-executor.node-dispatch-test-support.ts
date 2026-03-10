import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
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
  node_id: "node-1",
  capability: "tyrum.desktop",
  action_name: "snapshot",
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
      nodeCapabilityInspectionService: {
        inspect: vi.fn(async () => ({
          status: "ok",
          generated_at: new Date().toISOString(),
          node_id: "node-1",
          capability: "tyrum.desktop",
          capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          connected: true,
          paired: true,
          dispatchable: true,
          source_of_truth: {
            schema: "gateway_catalog",
            state: "node_capability_state",
          },
          actions: [
            {
              name: "snapshot",
              description: "Collect a desktop accessibility snapshot.",
              supported: true,
              enabled: true,
              availability_status: "unknown",
              input_schema: {},
              output_schema: {},
              consent: {
                requires_operator_enable: false,
                requires_runtime_consent: false,
                may_prompt_user: false,
                sensitive_data_category: "screen",
              },
              permissions: { browser_apis: [] },
              transport: {
                primitive_kind: "Desktop",
                op_field: "op",
                op_value: "snapshot",
                result_channel: "result_or_evidence",
                artifactize_binary_fields: [],
              },
            },
          ],
        })),
      } as never,
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
      { node_id: "node-1", capability: "screen", action_name: "capture" },
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
      input: { include_tree: false },
    });

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledOnce();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      {
        type: "Desktop",
        args: {
          op: "snapshot",
          include_tree: false,
          max_nodes: 2048,
          max_text_chars: 32768,
        },
      },
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-1" },
    );
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain('"ok":true');
    expect(result.output).toContain('"task_id":"task-123"');
    expect(result.output).toContain('"node_id":"node-1"');
    expect(result.output).toContain('"foo":"bar"');
  });

  it("tool.node.dispatch does not allow input.op to override the catalog action", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-123",
        result: { ok: true, evidence: { foo: "bar" } },
      })),
    };

    const result = await executeNodeDispatch(home, nodeDispatchService, {
      ...nodeDispatchArgs,
      input: { op: "act", include_tree: false },
    });

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledOnce();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Desktop",
        args: expect.objectContaining({
          op: "snapshot",
          include_tree: false,
        }),
      }),
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-1" },
    );
  });

  it("tool.node.dispatch returns a structured, retryable timeout error", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        throw new Error("task result timeout: task-123");
      }),
    };

    const result = await executeNodeDispatch(home, nodeDispatchService, {
      ...nodeDispatchArgs,
      input: { include_tree: false },
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('"ok":false');
    expect(result.output).toContain('"code":"dispatch_timeout"');
    expect(result.output).toContain('"retryable":true');
  });

  const structuredErrorCases = [
    {
      name: "tool.node.dispatch returns a structured unknown_node error when the target node is unknown",
      service: () =>
        new NodeDispatchService({
          connectionManager: new ConnectionManager(),
          taskResults: new TaskResultRegistry(),
        } as never),
      expectedCode: "runtime_unavailable",
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
      expectedCode: "capability_not_paired",
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
      expectedCode: "execution_failed",
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
    expect(result.output).toContain("payload too large");
    expect(result.output).not.toContain(huge.slice(0, 200));
  });

  it("tool.node.list defaults to the current work lane and returns structured inventory", async () => {
    const db = openTestSqliteDb();

    try {
      const nodeInventoryService = {
        list: vi.fn(async () => ({
          key: "agent:default:ui:default:channel:thread-1",
          lane: "main",
          nodes: [
            {
              node_id: "node-1",
              connected: true,
              paired_status: "approved",
              attached_to_requested_lane: true,
              capabilities: [
                {
                  capability: "tyrum.desktop",
                  dispatchable: true,
                  capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                  connected: true,
                  paired: true,
                  supported_action_count: 7,
                  enabled_action_count: 1,
                  available_action_count: 0,
                  unknown_action_count: 1,
                },
              ],
            },
          ],
        })),
      };

      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeInventoryService: nodeInventoryService as never,
      }).execute(
        "tool.node.list",
        "call-8",
        {},
        {
          work_session_key: "agent:default:ui:default:channel:thread-1",
          work_lane: "main",
        },
      );

      expect(nodeInventoryService.list).toHaveBeenCalledWith({
        tenantId: DEFAULT_TENANT_ID,
        capability: undefined,
        dispatchableOnly: true,
        key: "agent:default:ui:default:channel:thread-1",
        lane: "main",
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"status":"ok"');
      expect(result.output).toContain('"attached_to_requested_lane":true');
    } finally {
      await db.close();
    }
  });

  it("tool.node.inspect returns a tool error when inspection fails", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeCapabilityInspectionService: {
          inspect: vi.fn(async () => {
            throw new Error("unknown_node: node-404");
          }),
        } as never,
      }).execute("tool.node.inspect", "call-9", {
        node_id: "node-404",
        capability: "tyrum.browser",
      });

      expect(result.output).toBe("");
      expect(result.error).toBe("unknown_node: node-404");
    } finally {
      await db.close();
    }
  });
}
