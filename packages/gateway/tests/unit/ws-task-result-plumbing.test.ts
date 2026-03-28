import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { associateClusterTaskResultRoute } from "../../src/ws/protocol/cluster-task-result-routing.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  capabilityDescriptorsForClientCapability,
  descriptorIdsForClientCapability,
} from "@tyrum/contracts";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

function toTaskResult(
  success: boolean,
  result: unknown,
  evidence: unknown,
  error: string | undefined,
) {
  const taskResult: {
    ok: boolean;
    result?: unknown;
    evidence?: unknown;
    error?: string;
  } = { ok: success };

  if (result !== undefined) taskResult.result = result;
  if (evidence !== undefined) taskResult.evidence = evidence;
  if (!success) taskResult.error = error ?? "task failed";

  return taskResult;
}

describe("WS task.execute result plumbing", () => {
  const screenshotDescriptorId = "tyrum.desktop.screenshot";

  it("plumbs task.execute result + evidence to onTaskResult", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(
      nodeWs as never,
      capabilityDescriptorsForClientCapability("desktop"),
      {
        id: "conn-1",
        role: "node",
        deviceId: "node-1",
        protocolRev: 2,
      },
    );

    const onTaskResult = vi.fn();
    const deps: ProtocolDeps = {
      connectionManager: cm,
      onTaskResult,
    };

    const taskId = "task-1";
    const nodeClient = cm.getClient(connectionId)!;
    await handleClientMessage(
      nodeClient,
      JSON.stringify({
        request_id: taskId,
        type: "task.execute",
        ok: true,
        result: { result: { ok: true }, evidence: { foo: "bar" } },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledOnce();
    expect(onTaskResult).toHaveBeenCalledWith(
      taskId,
      true,
      { ok: true },
      { foo: "bar" },
      undefined,
    );
  });

  it("dispatches task.execute and resolves the awaiting caller exactly once", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(
      nodeWs as never,
      capabilityDescriptorsForClientCapability("desktop"),
      {
        id: "conn-1",
        role: "node",
        deviceId: "node-1",
        protocolRev: 2,
      },
    );

    const registry = new TaskResultRegistry();
    const resolveSpy = vi.spyOn(registry, "resolve");

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: descriptorIdsForClientCapability("desktop").map((id) => ({
              id,
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            })),
          };
        },
      } as never,
      onTaskResult: (taskId, success, result, evidence, error) => {
        registry.resolve(taskId, toTaskResult(success, result, evidence, error));
      },
      onConnectionClosed: (closedConnectionId) => {
        registry.rejectAllForConnection(closedConnectionId);
      },
    };

    const taskId = await dispatchTask(
      { type: "Desktop", args: { op: "screenshot" } },
      { turnId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
      deps,
    );

    expect(connectionId).toBe("conn-1");
    expect(nodeWs.send).toHaveBeenCalledOnce();
    const dispatched = JSON.parse(nodeWs.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(dispatched["type"]).toBe("task.execute");
    expect(dispatched["request_id"]).toBe(taskId);

    const awaiting = registry.wait(taskId, { timeoutMs: 5_000 });

    const nodeClient = cm.getClient(connectionId)!;
    await handleClientMessage(
      nodeClient,
      JSON.stringify({
        request_id: taskId,
        type: "task.execute",
        ok: true,
        result: { evidence: { foo: "bar" } },
      }),
      deps,
    );

    await expect(awaiting).resolves.toEqual({ ok: true, evidence: { foo: "bar" } });

    await handleClientMessage(
      nodeClient,
      JSON.stringify({
        request_id: taskId,
        type: "task.execute",
        ok: true,
        result: { evidence: { foo: "bar" } },
      }),
      deps,
    );

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy.mock.results[0]?.value).toBe(true);
    expect(resolveSpy.mock.results[1]?.value).toBe(false);
  });

  it("stamps remote cluster task.execute requests with the origin edge id", async () => {
    const cm = new ConnectionManager();
    const outboxDal = {
      enqueue: vi.fn(async () => undefined),
    };
    const remoteCapabilities = capabilityDescriptorsForClientCapability("desktop");
    const remoteNode = {
      connection_id: "conn-remote-1",
      edge_id: "edge-remote",
      device_id: "node-remote",
      protocol_rev: 2,
      role: "node",
      capabilities: remoteCapabilities,
      ready_capabilities: remoteCapabilities,
      expires_at_ms: Date.now() + 60_000,
      last_seen_at_ms: Date.now(),
    };

    const deps: ProtocolDeps = {
      connectionManager: cm,
      cluster: {
        edgeId: "edge-origin",
        outboxDal: outboxDal as never,
        connectionDirectory: {
          listConnectionsForCapability: vi.fn(async () => [remoteNode]),
        } as never,
      },
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: descriptorIdsForClientCapability("desktop").map((id) => ({
              id,
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            })),
          };
        },
      } as never,
    };

    const taskId = await dispatchTask(
      { type: "Desktop", args: { op: "screenshot" } },
      { tenantId: "tenant-1", turnId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
      deps,
    );

    expect(taskId).toMatch(/^task-/);
    expect(outboxDal.enqueue).toHaveBeenCalledOnce();
    expect(outboxDal.enqueue).toHaveBeenCalledWith(
      "tenant-1",
      "ws.direct",
      expect.objectContaining({
        connection_id: "conn-remote-1",
        message: expect.objectContaining({
          request_id: taskId,
          type: "task.execute",
          trace: { source_edge_id: "edge-origin" },
        }),
      }),
      { targetEdgeId: "edge-remote" },
    );
  });

  it("relays cluster task.execute results back to the originating edge", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(
      nodeWs as never,
      capabilityDescriptorsForClientCapability("desktop"),
      {
        id: "conn-1",
        role: "node",
        deviceId: "node-1",
        protocolRev: 2,
      },
    );

    const outboxDal = {
      enqueue: vi.fn(async () => undefined),
    };
    associateClusterTaskResultRoute("task-relay-1", {
      tenantId: "tenant-1",
      originEdgeId: "edge-origin",
    });

    const onTaskResult = vi.fn();
    const deps: ProtocolDeps = {
      connectionManager: cm,
      cluster: {
        edgeId: "edge-remote",
        outboxDal: outboxDal as never,
        connectionDirectory: {} as never,
      },
      onTaskResult,
    };

    const nodeClient = cm.getClient(connectionId)!;
    const result = await handleClientMessage(
      nodeClient,
      JSON.stringify({
        request_id: "task-relay-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { foo: "bar" } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(outboxDal.enqueue).toHaveBeenCalledWith(
      "tenant-1",
      "ws.cluster.task_result",
      {
        task_id: "task-relay-1",
        task_result: { ok: true, evidence: { foo: "bar" } },
      },
      { targetEdgeId: "edge-origin" },
    );
    expect(onTaskResult).not.toHaveBeenCalled();
  });

  it("rejects awaiting tasks when the dispatched connection closes", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(
      nodeWs as never,
      capabilityDescriptorsForClientCapability("desktop"),
      {
        id: "conn-1",
        role: "node",
        deviceId: "node-1",
        protocolRev: 2,
      },
    );

    const registry = new TaskResultRegistry();

    const deps: ProtocolDeps = {
      connectionManager: cm,
      taskResults: registry,
      nodePairingDal: {
        getByNodeId: async () => {
          return {
            status: "approved",
            capability_allowlist: [
              { id: screenshotDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
            ],
          };
        },
      } as never,
      onTaskResult: (taskId, success, result, evidence, error) => {
        registry.resolve(taskId, toTaskResult(success, result, evidence, error));
      },
      onConnectionClosed: (closedConnectionId) => {
        registry.rejectAllForConnection(closedConnectionId);
      },
    };

    const taskId = await dispatchTask(
      { type: "Desktop", args: { op: "screenshot" } },
      { turnId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
      deps,
    );

    const awaiting = registry.wait(taskId, { timeoutMs: 5_000 });
    const rejection = expect(awaiting).rejects.toThrow(/disconnected/i);

    deps.onConnectionClosed?.(connectionId);

    await rejection;
  });
});
