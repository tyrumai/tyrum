import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(registry: TaskResultRegistry): MockWebSocket {
  return {
    send: vi.fn((raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const requestId = parsed["request_id"];
        if (typeof requestId === "string" && requestId.trim().length > 0) {
          registry.resolve(requestId, { ok: true, evidence: { foo: "bar" } });
        }
      } catch {
        // ignore
      }
    }),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

describe("NodeDispatchService", () => {
  it("dispatches task.execute and awaits the task result registry", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: [
              { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
            ],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService(deps);
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: {} },
      {
        runId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      },
      { timeoutMs: 5_000 },
    );

    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(res.taskId).toMatch(/^task-/);
    expect(res.result).toEqual({ ok: true, evidence: { foo: "bar" } });
  });

  it("evaluates policy using an op-aware desktop match target", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const evaluateToolCall = vi.fn(async () => {
      return { decision: "allow" as const };
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall,
      } as never,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: [
              { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
            ],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService(deps);
    await service.dispatchAndWait(
      { type: "Desktop", args: { op: "mouse", action: "click", x: 1, y: 2 } },
      {
        runId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      },
      { timeoutMs: 5_000 },
    );

    expect(evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "tool.node.dispatch",
        toolMatchTarget: "capability:tyrum.desktop;action:Desktop;op:act;act:mouse",
      }),
    );
  });

  it("dispatches to approved nodes even when policy returns require_approval", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(async () => {
          return { decision: "require_approval" };
        }),
      } as never,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: [
              { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
            ],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService(deps);
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: {} },
      {
        runId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      },
      { timeoutMs: 5_000 },
    );

    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(res.result.ok).toBe(true);
  });

  it("targets the requested node id without falling back to another eligible node", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const firstWs = createMockWs(registry);
    const secondWs = createMockWs(registry);
    cm.addClient(firstWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.addClient(secondWs as never, ["desktop"], {
      id: "conn-2",
      role: "node",
      deviceId: "node-2",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.setReadyCapabilities("conn-1", []);

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => ({
          status: "approved",
          capability_allowlist: [
            { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
          ],
        }),
      } as never,
    };

    const service = new NodeDispatchService(deps);
    await expect(
      service.dispatchAndWait(
        { type: "Desktop", args: {} },
        {
          tenantId: "default",
          runId: crypto.randomUUID(),
          stepId: crypto.randomUUID(),
          attemptId: crypto.randomUUID(),
        },
        { timeoutMs: 5_000, nodeId: "node-1" },
      ),
    ).rejects.toThrow(/not ready/i);

    expect(firstWs.send).not.toHaveBeenCalled();
    expect(secondWs.send).not.toHaveBeenCalled();
  });

  it("targets the requested approved node when multiple eligible nodes exist", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const firstWs = createMockWs(registry);
    const secondWs = createMockWs(registry);
    cm.addClient(firstWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.addClient(secondWs as never, ["desktop"], {
      id: "conn-2",
      role: "node",
      deviceId: "node-2",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => ({
          status: "approved",
          capability_allowlist: [
            { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
          ],
        }),
      } as never,
    };

    const service = new NodeDispatchService(deps);
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: {} },
      {
        tenantId: "default",
        runId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      },
      { timeoutMs: 5_000, nodeId: "node-2" },
    );

    expect(res.result.ok).toBe(true);
    expect(firstWs.send).not.toHaveBeenCalled();
    expect(secondWs.send).toHaveBeenCalledOnce();
  });

  it("rejects when task result registry is missing", async () => {
    const { NodeDispatchService } =
      await import("../../src/modules/agent/node-dispatch-service.js");

    const cm = new ConnectionManager();
    const deps: ProtocolDeps = {
      connectionManager: cm,
    };

    const service = new NodeDispatchService(deps);

    await expect(
      service.dispatchAndWait(
        { type: "Desktop", args: {} },
        {
          runId: crypto.randomUUID(),
          stepId: crypto.randomUUID(),
          attemptId: crypto.randomUUID(),
        },
        { timeoutMs: 5_000 },
      ),
    ).rejects.toThrow(/task result registry/i);
  });
});
