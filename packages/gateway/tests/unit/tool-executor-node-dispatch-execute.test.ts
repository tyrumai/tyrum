import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { executeNodeDispatchRequest } from "../../src/modules/agent/tool-executor-node-dispatch-execute.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

function sampleInspection(capability: string, actionName: string) {
  return {
    status: "ok" as const,
    generated_at: "2026-03-19T10:00:00.000Z",
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
        description: "Dispatch a cross-platform location read.",
        supported: true,
        enabled: true,
        availability_status: "unknown" as const,
        input_schema: {},
        output_schema: {},
        consent: {
          requires_operator_enable: true,
          requires_runtime_consent: true,
          may_prompt_user: true,
          sensitive_data_category: "location" as const,
        },
        permissions: {
          secure_context_required: false,
          browser_apis: [],
          hardware_may_be_required: true,
        },
        transport: {
          primitive_kind: null,
          op_field: "op",
          op_value: actionName,
          result_channel: "evidence" as const,
          artifactize_binary_fields: [],
        },
      },
    ],
  };
}

describe("executeNodeDispatchRequest", () => {
  it("maps web device platforms to the Browser primitive for cross-platform actions", async () => {
    const connectionManager = new ConnectionManager();
    const nodeWs = { on: vi.fn(), send: vi.fn(), readyState: 1 } as never;
    connectionManager.addClient(nodeWs, [], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      devicePlatform: "web",
      protocolRev: 2,
    });

    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-1",
      result: {
        ok: true,
        evidence: { latitude: 52.37, longitude: 4.89 },
        result: undefined,
        error: undefined,
      },
    }));

    const response = await executeNodeDispatchRequest(
      {
        tenantId: DEFAULT_TENANT_ID,
        connectionManager,
        inspectionService: {
          inspect: vi.fn(async () => sampleInspection("tyrum.location.get", "get")),
        } as never,
        nodeDispatchService: { dispatchAndWait } as never,
      },
      {
        node_id: "node-1",
        capability: "tyrum.location.get",
        action_name: "get",
        input: {},
        timeout_ms: 1_000,
      },
    );

    expect(dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Browser",
        args: expect.objectContaining({ op: "get" }),
      }),
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      { timeoutMs: 1_000, nodeId: "node-1" },
    );
    expect(response.ok).toBe(true);
    expect(response.payload_source).toBe("evidence");
  });

  it("maps canonical facing_mode to a mobile camera target before dispatch", async () => {
    const connectionManager = new ConnectionManager();
    const nodeWs = { on: vi.fn(), send: vi.fn(), readyState: 1 } as never;
    connectionManager.addClient(nodeWs, [], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      devicePlatform: "ios",
      protocolRev: 2,
    });

    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-1",
      result: {
        ok: true,
        evidence: { mime: "image/jpeg" },
        result: undefined,
        error: undefined,
      },
    }));

    await executeNodeDispatchRequest(
      {
        tenantId: DEFAULT_TENANT_ID,
        connectionManager,
        inspectionService: {
          inspect: vi.fn(async () =>
            sampleInspection("tyrum.camera.capture-photo", "capture_photo"),
          ),
        } as never,
        nodeDispatchService: { dispatchAndWait } as never,
      },
      {
        node_id: "node-1",
        capability: "tyrum.camera.capture-photo",
        action_name: "capture_photo",
        input: { facing_mode: "user", format: "jpeg", quality: 0.9 },
      },
    );

    expect(dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IOS",
        args: expect.objectContaining({
          op: "capture_photo",
          camera: "front",
          format: "jpeg",
          quality: 0.9,
        }),
      }),
      expect.any(Object),
      expect.objectContaining({ nodeId: "node-1" }),
    );
  });

  it("preserves canonical camera args for browser dispatch", async () => {
    const connectionManager = new ConnectionManager();
    const nodeWs = { on: vi.fn(), send: vi.fn(), readyState: 1 } as never;
    connectionManager.addClient(nodeWs, [], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      devicePlatform: "web",
      protocolRev: 2,
    });

    const dispatchAndWait = vi.fn(async () => ({
      taskId: "task-1",
      result: {
        ok: true,
        evidence: { mime: "image/jpeg" },
        result: undefined,
        error: undefined,
      },
    }));

    await executeNodeDispatchRequest(
      {
        tenantId: DEFAULT_TENANT_ID,
        connectionManager,
        inspectionService: {
          inspect: vi.fn(async () =>
            sampleInspection("tyrum.camera.capture-photo", "capture_photo"),
          ),
        } as never,
        nodeDispatchService: { dispatchAndWait } as never,
      },
      {
        node_id: "node-1",
        capability: "tyrum.camera.capture-photo",
        action_name: "capture_photo",
        input: { facing_mode: "environment", format: "jpeg", quality: 0.92 },
      },
    );

    expect(dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Browser",
        args: expect.objectContaining({
          op: "capture_photo",
          facing_mode: "environment",
          format: "jpeg",
          quality: 0.92,
        }),
      }),
      expect.any(Object),
      expect.objectContaining({ nodeId: "node-1" }),
    );
  });
});
