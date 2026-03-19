import { describe, expect, it, vi } from "vitest";
import { NodeDispatchService } from "@tyrum/runtime-node-control";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";

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
  const desktopActDescriptor = {
    id: "tyrum.desktop.act",
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  } as const;
  const desktopMouseDescriptor = {
    id: "tyrum.desktop.mouse",
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  } as const;

  it("dispatches task.execute and awaits the task result registry", async () => {
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, [desktopActDescriptor], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: [desktopActDescriptor],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: { op: "act" } },
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
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, [desktopMouseDescriptor], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const evaluateToolCall = vi.fn(async () => {
      return { decision: "allow" as const };
    });

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
            capability_allowlist: [desktopMouseDescriptor],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
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
        toolMatchTarget: "capability:tyrum.desktop.mouse;action:Desktop;op:act;act:mouse",
      }),
    );
  });

  it("dispatches to approved nodes even when policy returns require_approval", async () => {
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const nodeWs = createMockWs(registry);
    cm.addClient(nodeWs as never, [desktopActDescriptor], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

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
            capability_allowlist: [desktopActDescriptor],
          };
        },
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: { op: "act" } },
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
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const firstWs = createMockWs(registry);
    const secondWs = createMockWs(registry);
    cm.addClient(firstWs as never, [desktopActDescriptor], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.addClient(secondWs as never, [desktopActDescriptor], {
      id: "conn-2",
      role: "node",
      deviceId: "node-2",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.setReadyCapabilities("conn-1", []);

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => ({
          status: "approved",
          capability_allowlist: [desktopActDescriptor],
        }),
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
    await expect(
      service.dispatchAndWait(
        { type: "Desktop", args: { op: "act" } },
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
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const firstWs = createMockWs(registry);
    const secondWs = createMockWs(registry);
    cm.addClient(firstWs as never, [desktopActDescriptor], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });
    cm.addClient(secondWs as never, [desktopActDescriptor], {
      id: "conn-2",
      role: "node",
      deviceId: "node-2",
      protocolRev: 2,
      authClaims: { tenant_id: "default" } as never,
    });

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => ({
          status: "approved",
          capability_allowlist: [desktopActDescriptor],
        }),
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: { op: "act" } },
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

  it("prefers a remote edge row for targeted dispatch when a stale local row is fresher", async () => {
    const cm = new ConnectionManager();
    const registry = new TaskResultRegistry();
    const enqueue = vi.fn(async (_tenantId: string, _topic: string, payload: unknown) => {
      const direct = payload as {
        connection_id?: string;
        message?: { request_id?: string };
      };
      const requestId = direct.message?.request_id;
      if (typeof requestId === "string" && requestId.length > 0) {
        registry.resolve(requestId, { ok: true, evidence: { foo: "bar" } });
      }
    });

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      cluster: {
        edgeId: "edge-local",
        outboxDal: { enqueue } as never,
        connectionDirectory: {
          listNonExpired: vi.fn(async () => [
            {
              role: "node",
              device_id: "node-1",
              connection_id: "conn-local-stale",
              edge_id: "edge-local",
              protocol_rev: 2,
              capabilities: [desktopActDescriptor],
              ready_capabilities: [desktopActDescriptor],
              last_seen_at_ms: 2_000,
              expires_at_ms: Date.now() + 30_000,
            },
            {
              role: "node",
              device_id: "node-1",
              connection_id: "conn-remote-live",
              edge_id: "edge-remote",
              protocol_rev: 2,
              capabilities: [desktopActDescriptor],
              ready_capabilities: [desktopActDescriptor],
              last_seen_at_ms: 1_000,
              expires_at_ms: Date.now() + 30_000,
            },
          ]),
        } as never,
      },
      nodePairingDal: {
        getByNodeId: async () => ({
          status: "approved",
          capability_allowlist: [desktopActDescriptor],
        }),
      } as never,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
      taskResults: registry,
    });
    const res = await service.dispatchAndWait(
      { type: "Desktop", args: { op: "act" } },
      {
        tenantId: "default",
        runId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      },
      { timeoutMs: 5_000, nodeId: "node-1" },
    );

    expect(res.result.ok).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      "default",
      "ws.direct",
      expect.objectContaining({ connection_id: "conn-remote-live" }),
      expect.objectContaining({ targetEdgeId: "edge-remote" }),
    );
  });

  it("rejects when task result registry is missing", async () => {
    const cm = new ConnectionManager();
    const deps: ProtocolDeps = {
      connectionManager: cm,
    };

    const service = new NodeDispatchService({
      dispatchTask: async (action, scope, nodeId) =>
        await depsDispatchTask(deps, action, scope, nodeId),
    });

    await expect(
      service.dispatchAndWait(
        { type: "Desktop", args: { op: "act" } },
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

async function depsDispatchTask(
  deps: ProtocolDeps,
  action: Parameters<(typeof import("../../src/ws/protocol.js"))["dispatchTask"]>[0],
  scope: Parameters<(typeof import("../../src/ws/protocol.js"))["dispatchTask"]>[1],
  nodeId?: string,
) {
  const { dispatchTask } = await import("../../src/ws/protocol.js");
  return await dispatchTask(action, scope, deps, nodeId);
}
