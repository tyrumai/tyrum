import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createToolExecutor,
  requireHomeDir,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

function createWorkspaceLease(db: ReturnType<typeof openTestSqliteDb>) {
  return {
    db,
    tenantId: DEFAULT_TENANT_ID,
    agentId: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
  };
}

function createInspection(capability: string, actionName: string) {
  return {
    status: "ok" as const,
    generated_at: new Date().toISOString(),
    node_id: "node-1",
    capability,
    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    connected: true,
    paired: true,
    dispatchable: true,
    source_of_truth: {
      schema: "gateway_catalog" as const,
      state: "node_capability_state" as const,
    },
    actions: [
      {
        name: actionName,
        description: "Dedicated tool action.",
        supported: true,
        enabled: true,
        availability_status: "unknown" as const,
        input_schema: {},
        output_schema: {},
        consent: {
          requires_operator_enable: true,
          requires_runtime_consent: false,
          may_prompt_user: false,
          sensitive_data_category: "none" as const,
        },
        permissions: {
          secure_context_required: false,
          browser_apis: [],
          hardware_may_be_required: false,
        },
        transport: {
          primitive_kind: "Web" as const,
          op_field: "op",
          op_value: actionName,
          result_channel: "result_or_evidence" as const,
          artifactize_binary_fields: [],
        },
      },
    ],
  };
}

function createWebNodeConnectionManager(...nodeIds: string[]) {
  const connectionManager = new ConnectionManager();
  for (const [index, nodeId] of nodeIds.entries()) {
    connectionManager.addClient({ on: vi.fn(), send: vi.fn(), readyState: 1 } as never, [], {
      id: `conn-${String(index + 1)}`,
      role: "node",
      deviceId: nodeId,
      devicePlatform: "web",
      protocolRev: 2,
      authClaims: { tenant_id: DEFAULT_TENANT_ID } as never,
    });
  }
  return connectionManager;
}

export function registerToolExecutorDedicatedNodeToolTests(home: HomeDirState): void {
  it("executes tool.browser.navigate through dedicated browser routing without generic dispatch args", async () => {
    const db = openTestSqliteDb();
    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-browser-1",
      result: { ok: true, result: { url: "https://example.com", title: "Example" } },
    }));

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeDispatchService: { dispatchAndWait } as never,
        nodeCapabilityInspectionService: {
          inspect: vi.fn(async () => createInspection("tyrum.browser.navigate", "navigate")),
        } as never,
      }).execute("tool.browser.navigate", "call-browser-1", {
        node_id: "node-1",
        url: "https://example.com",
      });

      expect(result.error).toBeUndefined();
      expect(dispatchAndWait).toHaveBeenCalledWith(
        {
          type: "Web",
          args: {
            op: "navigate",
            url: "https://example.com",
          },
        },
        expect.any(Object),
        { timeoutMs: 30_000, nodeId: "node-1" },
      );
      expect(result.output).toContain('"capability":"tyrum.browser.navigate"');
      expect(result.output).toContain('"action_name":"navigate"');
      expect(result.output).toContain('"node_id":"node-1"');
      expect(result.output).toContain('"url":"https://example.com"');
    } finally {
      await db.close();
    }
  });

  it("uses the attached dispatchable node when node_id is omitted for tool.location.get", async () => {
    const db = openTestSqliteDb();
    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-location-1",
      result: {
        ok: true,
        evidence: { coords: { latitude: 52.37, longitude: 4.89, accuracy_m: 8 } },
      },
    }));
    const connectionManager = createWebNodeConnectionManager("node-1", "node-2");

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeDispatchService: { dispatchAndWait } as never,
        nodeCapabilityInspectionService: {
          inspect: vi.fn(async () => ({
            ...createInspection("tyrum.location.get", "get"),
            actions: [
              {
                ...createInspection("tyrum.location.get", "get").actions[0],
                transport: {
                  primitive_kind: null,
                  op_field: "op",
                  op_value: "get",
                  result_channel: "evidence" as const,
                  artifactize_binary_fields: [],
                },
              },
            ],
          })),
        } as never,
        nodeInventoryService: {
          list: vi.fn(async () => ({
            key: "agent:default:ui:default:channel:thread-1",
            lane: "main",
            nodes: [
              {
                node_id: "node-1",
                connected: true,
                paired_status: "approved",
                attached_to_requested_conversation: true,
                capabilities: [
                  {
                    capability: "tyrum.location.get",
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    dispatchable: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 1,
                    unknown_action_count: 0,
                  },
                ],
              },
              {
                node_id: "node-2",
                connected: true,
                paired_status: "approved",
                attached_to_requested_lane: false,
                capabilities: [
                  {
                    capability: "tyrum.location.get",
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    dispatchable: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 1,
                    unknown_action_count: 0,
                  },
                ],
              },
            ],
          })),
        } as never,
        connectionManager,
      }).execute(
        "tool.location.get",
        "call-location-1",
        { enable_high_accuracy: true },
        {
          work_session_key: "agent:default:ui:default:channel:thread-1",
          work_lane: "main",
        },
      );

      expect(result.error).toBeUndefined();
      expect(dispatchAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ op: "get", enable_high_accuracy: true }),
        }),
        expect.any(Object),
        { timeoutMs: 30_000, nodeId: "node-1" },
      );
      expect(result.output).toContain('"node_id":"node-1"');
    } finally {
      await db.close();
    }
  });

  it("fails fast instead of guessing when multiple eligible nodes exist without an attached node", async () => {
    const db = openTestSqliteDb();
    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-location-2",
      result: { ok: true, evidence: { ok: true } },
    }));

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeDispatchService: { dispatchAndWait } as never,
        nodeCapabilityInspectionService: {
          inspect: vi.fn(async () => createInspection("tyrum.location.get", "get")),
        } as never,
        nodeInventoryService: {
          list: vi.fn(async () => ({
            nodes: [
              {
                node_id: "node-1",
                connected: true,
                paired_status: "approved",
                attached_to_requested_conversation: false,
                capabilities: [
                  {
                    capability: "tyrum.location.get",
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    dispatchable: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 1,
                    unknown_action_count: 0,
                  },
                ],
              },
              {
                node_id: "node-2",
                connected: true,
                paired_status: "approved",
                attached_to_requested_lane: false,
                capabilities: [
                  {
                    capability: "tyrum.location.get",
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    dispatchable: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 1,
                    unknown_action_count: 0,
                  },
                ],
              },
            ],
          })),
        } as never,
      }).execute("tool.location.get", "call-location-2", {});

      expect(result.output).toBe("");
      expect(result.error).toContain("ambiguous node selection");
      expect(dispatchAndWait).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}
