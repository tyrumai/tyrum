import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
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

export function registerToolExecutorNodeToolTests(home: HomeDirState): void {
  it("tool.node.list defaults to the current work conversation and returns structured inventory", async () => {
    const db = openTestSqliteDb();

    try {
      const nodeInventoryService = {
        list: vi.fn(async () => ({
          conversation_key: "agent:default:ui:default:channel:thread-1",
          nodes: [
            {
              node_id: "node-1",
              connected: true,
              paired_status: "approved",
              attached_to_requested_conversation: true,
              source_client_device_id: "client-1",
              capabilities: [
                {
                  capability: "tyrum.desktop.snapshot",
                  dispatchable: true,
                  capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                  connected: true,
                  ready: true,
                  paired: true,
                  supported_action_count: 1,
                  enabled_action_count: 1,
                  available_action_count: 1,
                  unknown_action_count: 0,
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
          work_conversation_key: "agent:default:ui:default:channel:thread-1",
        },
      );

      expect(nodeInventoryService.list).toHaveBeenCalledWith({
        tenantId: DEFAULT_TENANT_ID,
        capability: undefined,
        dispatchableOnly: false,
        key: "agent:default:ui:default:channel:thread-1",
        lane: "main",
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"status":"ok"');
      expect(result.output).toContain('"applied_filters":{"dispatchable_only":false');
      expect(result.output).toContain('"attached_to_requested_conversation":true');
      expect(result.output).toContain('"paired_status":"approved"');
      expect(result.output).not.toContain('"source_client_device_id":"client-1"');
      expect(result.output).toContain('"dispatchable":true');
      expect(result.output).toContain('"paired":true');
      expect(result.output).toContain('"ready":true');
    } finally {
      await db.close();
    }
  });

  it("tool.node.list keeps full node capability inventory while marking which capability matched", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeInventoryService: {
          list: vi.fn(async () => ({
            conversation_key: "agent:default:ui:default:channel:thread-1",
            nodes: [
              {
                node_id: "node-1",
                connected: true,
                paired_status: "approved",
                attached_to_requested_conversation: false,
                capabilities: [
                  {
                    capability: "tyrum.desktop.screenshot",
                    dispatchable: true,
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 0,
                    unknown_action_count: 1,
                  },
                  {
                    capability: "tyrum.desktop.query",
                    dispatchable: true,
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
                    ready: true,
                    paired: true,
                    supported_action_count: 1,
                    enabled_action_count: 1,
                    available_action_count: 0,
                    unknown_action_count: 1,
                  },
                ],
              },
            ],
          })),
        } as never,
      }).execute("tool.node.list", "call-8b", {
        capability: "tyrum.desktop.query",
      });

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"matched_capabilities":["tyrum.desktop.query"]');
      expect(result.output).toContain('"capability":"tyrum.desktop.screenshot"');
      expect(result.output).toContain('"capability":"tyrum.desktop.query"');
    } finally {
      await db.close();
    }
  });

  it("tool.node.capability.get returns action-level capability detail", async () => {
    const db = openTestSqliteDb();

    try {
      const inspectionService = {
        inspect: vi.fn(async () => ({
          status: "ok" as const,
          generated_at: "2026-03-21T00:00:00.000Z",
          node_id: "node-1",
          capability: "tyrum.browser.navigate",
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
              name: "navigate",
              description: "Navigate to a URL.",
              supported: true,
              enabled: true,
              availability_status: "available" as const,
              input_schema: { type: "object" },
              output_schema: { type: "object" },
              consent: {
                requires_operator_enable: false,
                requires_runtime_consent: false,
                may_prompt_user: false,
                sensitive_data_category: "screen" as const,
              },
              permissions: { browser_apis: [] },
              transport: {
                primitive_kind: "Web" as const,
                op_field: "op",
                op_value: "navigate",
                result_channel: "result_or_evidence" as const,
                artifactize_binary_fields: [],
              },
            },
          ],
        })),
      };

      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeCapabilityInspectionService: inspectionService as never,
      }).execute("tool.node.capability.get", "call-8d", {
        node_id: "node-1",
        capability: "tyrum.browser.navigate",
      });

      expect(inspectionService.inspect).toHaveBeenCalledWith({
        tenantId: DEFAULT_TENANT_ID,
        nodeId: "node-1",
        capabilityId: "tyrum.browser.navigate",
        includeDisabled: false,
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain('"capability":"tyrum.browser.navigate"');
      expect(result.output).toContain('"name":"navigate"');
      expect(result.output).toContain('"availability_status":"available"');
    } finally {
      await db.close();
    }
  });

  it("tool.node.list rejects legacy umbrella capability filters", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeInventoryService: {
          list: vi.fn(async () => ({
            key: undefined,
            lane: undefined,
            nodes: [],
          })),
        } as never,
      }).execute("tool.node.list", "call-8a", {
        capability: "tyrum.desktop",
      });

      expect(result.output).toBe("");
      expect(result.error).toContain("legacy umbrella capability");
    } finally {
      await db.close();
    }
  });

  it("tool.node.list rejects wildcard capability filters", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeInventoryService: {
          list: vi.fn(async () => ({
            key: undefined,
            lane: undefined,
            nodes: [],
          })),
        } as never,
      }).execute("tool.node.list", "call-8c", {
        capability: "*",
      });

      expect(result.output).toBe("");
      expect(result.error).toContain("wildcard capability filters are not supported");
    } finally {
      await db.close();
    }
  });
}
