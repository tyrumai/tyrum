import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";

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
  it("plumbs task.execute result + evidence to onTaskResult", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

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
    const connectionId = cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    expect(desktopDescriptorId).toBeDefined();

    const registry = new TaskResultRegistry();
    const resolveSpy = vi.spyOn(registry, "resolve");

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
      onTaskResult: (taskId, success, result, evidence, error) => {
        registry.resolve(taskId, toTaskResult(success, result, evidence, error));
      },
      onConnectionClosed: (closedConnectionId) => {
        registry.rejectAllForConnection(closedConnectionId);
      },
    };

    const taskId = await dispatchTask(
      { type: "Desktop", args: {} },
      { runId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
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

  it("rejects awaiting tasks when the dispatched connection closes", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    const connectionId = cm.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: "node-1",
      protocolRev: 2,
    });

    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    expect(desktopDescriptorId).toBeDefined();

    const registry = new TaskResultRegistry();

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
      onTaskResult: (taskId, success, result, evidence, error) => {
        registry.resolve(taskId, toTaskResult(success, result, evidence, error));
      },
      onConnectionClosed: (closedConnectionId) => {
        registry.rejectAllForConnection(closedConnectionId);
      },
    };

    const taskId = await dispatchTask(
      { type: "Desktop", args: {} },
      { runId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
      deps,
    );

    const awaiting = registry.wait(taskId, { timeoutMs: 5_000 });
    const rejection = expect(awaiting).rejects.toThrow(/disconnected/i);

    deps.onConnectionClosed?.(connectionId);

    await rejection;
  });
});
