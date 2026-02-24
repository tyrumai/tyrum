import { describe, expect, it, vi } from "vitest";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

describe("OutboxPoller", () => {
  it("acks only after processing succeeds (retries on processing error)", async () => {
    const connectionManager = new ConnectionManager();
    const ws = createMockWs();
    connectionManager.addClient(ws as never, ["cli"]);

    const circular: Record<string, unknown> = {};
    (circular as Record<string, unknown>)["self"] = circular;

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: { message: circular },
          created_at: nowIso,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-1",
              type: "plan.update",
              occurred_at: nowIso,
              payload: { plan_id: "p1", status: "running" },
            },
          },
          created_at: nowIso,
        },
      ])
      .mockResolvedValueOnce([]);

    const ackConsumerCursor = vi.fn(async () => undefined);

    const outboxDal = {
      poll,
      ackConsumerCursor,
    } as unknown as import("../../src/modules/backplane/outbox-dal.js").OutboxDal;

    const poller = new OutboxPoller({
      consumerId: "edge-a",
      outboxDal,
      connectionManager,
    });

    await poller.tick();
    expect(ackConsumerCursor).not.toHaveBeenCalled();

    await poller.tick();
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("records dispatched attempt executors when delivering task.execute to nodes", async () => {
    const connectionManager = new ConnectionManager();
    const ws = createMockWs();
    connectionManager.addClient(ws as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.direct",
          target_edge_id: null,
          payload: {
            connection_id: "node-1",
            message: {
              request_id: "task-1",
              type: "task.execute",
              payload: {
                run_id: "550e8400-e29b-41d4-a716-446655440000",
                step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
                attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
                action: { type: "CLI", args: { command: "echo hi" } },
              },
            },
          },
          created_at: nowIso,
        },
      ])
      .mockResolvedValueOnce([]);

    const ackConsumerCursor = vi.fn(async () => undefined);
    const outboxDal = {
      poll,
      ackConsumerCursor,
    } as unknown as import("../../src/modules/backplane/outbox-dal.js").OutboxDal;

    const poller = new OutboxPoller({
      consumerId: "edge-a",
      outboxDal,
      connectionManager,
    });

    await poller.tick();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(connectionManager.getDispatchedAttemptExecutor("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e")).toBe("dev_test");
  });
});
