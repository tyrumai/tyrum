import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { expect, it, vi } from "vitest";
import { getDedicatedDesktopToolDefinition } from "../../src/modules/agent/tool-desktop-definitions.js";
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

async function executeDedicatedDesktopTool(
  home: HomeDirState,
  toolId: string,
  nodeDispatchService: object,
  args: Record<string, unknown>,
  nodeInventoryService?: object,
) {
  const db = openTestSqliteDb();
  const definition = getDedicatedDesktopToolDefinition(toolId);

  if (!definition) {
    throw new Error(`missing dedicated desktop tool definition for ${toolId}`);
  }

  try {
    return await createToolExecutor({
      homeDir: requireHomeDir(home),
      workspaceLease: createWorkspaceLease(db),
      nodeDispatchService: nodeDispatchService as never,
      nodeInventoryService: nodeInventoryService as never,
      nodeCapabilityInspectionService: {
        inspect: vi.fn(async () => ({
          status: "ok",
          generated_at: new Date().toISOString(),
          node_id: "node-1",
          capability: definition.capabilityId,
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
              name: definition.actionName,
              description: definition.description,
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
                op_value: definition.actionName,
                result_channel: "result_or_evidence",
                artifactize_binary_fields: [],
              },
            },
          ],
        })),
      } as never,
    }).execute(toolId, "call-dedicated-1", args);
  } finally {
    await db.close();
  }
}

export function registerToolExecutorDesktopToolTests(home: HomeDirState): void {
  it("tool.desktop.snapshot delegates to node dispatch service with an explicit node_id", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-321",
        result: { ok: true, evidence: { foo: "bar" } },
      })),
    };

    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.snapshot",
      nodeDispatchService,
      {
        node_id: "node-1",
        include_tree: false,
      },
    );

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
    expect(result.output).toContain('"task_id":"task-321"');
    expect(result.output).toContain('"node_id":"node-1"');
  });

  it("tool.desktop.snapshot auto-selects the sole eligible node when node_id is omitted", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-sole-1",
        result: { ok: true, evidence: { foo: "bar" } },
      })),
    };
    const nodeInventoryService = {
      list: vi.fn(async () => ({
        nodes: [{ node_id: "node-sole", attached_to_requested_conversation: false }],
      })),
    };

    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.snapshot",
      nodeDispatchService,
      { include_tree: false },
      nodeInventoryService,
    );

    expect(result.error).toBeUndefined();
    expect(nodeInventoryService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "tyrum.desktop.snapshot",
        dispatchableOnly: true,
      }),
    );
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-sole" },
    );
    expect(result.output).toContain('"node_id":"node-sole"');
  });

  it("tool.desktop.snapshot prefers the attached eligible node when node_id is omitted", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-attached-1",
        result: { ok: true, evidence: { foo: "bar" } },
      })),
    };
    const nodeInventoryService = {
      list: vi.fn(async () => ({
        nodes: [
          { node_id: "node-free", attached_to_requested_conversation: false },
          { node_id: "node-attached", attached_to_requested_conversation: true },
        ],
      })),
    };

    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.snapshot",
      nodeDispatchService,
      { include_tree: false },
      nodeInventoryService,
    );

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-attached" },
    );
    expect(result.output).toContain('"node_id":"node-attached"');
  });

  it("tool.desktop.snapshot fails when node selection is ambiguous", async () => {
    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.snapshot",
      {
        dispatchAndWait: vi.fn(async () => ({
          taskId: "task-ambiguous",
          result: { ok: true, evidence: { foo: "bar" } },
        })),
      },
      { include_tree: false },
      {
        list: vi.fn(async () => ({
          nodes: [
            { node_id: "node-1", attached_to_requested_conversation: false },
            { node_id: "node-2", attached_to_requested_conversation: false },
          ],
        })),
      },
    );

    expect(result.output).toBe("");
    expect(result.error).toContain("ambiguous node selection");
  });

  it("tool.desktop.wait-for preserves the action timeout_ms in the node input", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-wait-for-1",
        result: { ok: true, result: { matched: true } },
      })),
    };

    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.wait-for",
      nodeDispatchService,
      {
        node_id: "node-1",
        selector: { kind: "ocr", text: "Done" },
        state: "visible",
        timeout_ms: 45_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Desktop",
        args: expect.objectContaining({
          op: "wait_for",
          selector: expect.objectContaining({ kind: "ocr", text: "Done" }),
          state: "visible",
          timeout_ms: 45_000,
          poll_ms: 250,
        }),
      }),
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-1" },
    );
  });

  it("tool.desktop.wait-for uses dispatch_timeout_ms as the routing timeout", async () => {
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-wait-for-2",
        result: { ok: true, result: { matched: true } },
      })),
    };

    const result = await executeDedicatedDesktopTool(
      home,
      "tool.desktop.wait-for",
      nodeDispatchService,
      {
        node_id: "node-1",
        selector: { kind: "ocr", text: "Done" },
        state: "visible",
        timeout_ms: 45_000,
        dispatch_timeout_ms: 90_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Desktop",
        args: expect.objectContaining({
          op: "wait_for",
          selector: expect.objectContaining({ kind: "ocr", text: "Done" }),
          state: "visible",
          timeout_ms: 45_000,
          poll_ms: 250,
        }),
      }),
      expect.any(Object),
      { timeoutMs: 90_000, nodeId: "node-1" },
    );
  });
}
