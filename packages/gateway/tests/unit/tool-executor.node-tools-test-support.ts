import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/schemas";
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
              source_client_device_id: "client-1",
              capabilities: [
                {
                  capability: "tyrum.desktop.snapshot",
                  dispatchable: true,
                  capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                  connected: true,
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
      expect(result.output).toContain('"applied_filters":{"dispatchable_only":true');
      expect(result.output).not.toContain('"attached_to_requested_lane":true');
      expect(result.output).not.toContain('"paired_status":"approved"');
      expect(result.output).not.toContain('"source_client_device_id":"client-1"');
      expect(result.output).not.toContain('"dispatchable":true');
      expect(result.output).not.toContain('"paired":true');
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
            key: "agent:default:ui:default:channel:thread-1",
            lane: "main",
            nodes: [
              {
                node_id: "node-1",
                connected: true,
                paired_status: "approved",
                attached_to_requested_lane: false,
                capabilities: [
                  {
                    capability: "tyrum.desktop.screenshot",
                    dispatchable: true,
                    capability_version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                    connected: true,
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
        capability: "tyrum.location.get",
      });

      expect(result.output).toBe("");
      expect(result.error).toBe("unknown_node: node-404");
    } finally {
      await db.close();
    }
  });

  it("tool.node.inspect rejects legacy umbrella capability IDs", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: createWorkspaceLease(db),
        nodeCapabilityInspectionService: {
          inspect: vi.fn(async () => {
            throw new Error("should not be called");
          }),
        } as never,
      }).execute("tool.node.inspect", "call-9a", {
        node_id: "node-404",
        capability: "tyrum.browser",
      });

      expect(result.output).toBe("");
      expect(result.error).toContain("legacy umbrella capability");
    } finally {
      await db.close();
    }
  });
}
