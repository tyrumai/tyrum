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
  it("broadcasts auth audit events only to operator-scoped clients", async () => {
    const connectionManager = new ConnectionManager();
    const operatorWs = createMockWs();
    const otherWs = createMockWs();
    connectionManager.addClient(operatorWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_operator_1",
        scopes: ["operator.read"],
      },
    });
    connectionManager.addClient(otherWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: [],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-1",
              type: "auth.failed",
              occurred_at: nowIso,
              scope: { kind: "global" },
              payload: { surface: "ws.upgrade" },
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
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(operatorWs.send).toHaveBeenCalledTimes(1);
    expect(otherWs.send).not.toHaveBeenCalled();
  });

  it("gates auth audit broadcasts even when event_id is missing", async () => {
    const connectionManager = new ConnectionManager();
    const operatorWs = createMockWs();
    const otherWs = createMockWs();
    connectionManager.addClient(operatorWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_operator_1",
        scopes: ["operator.read"],
      },
    });
    connectionManager.addClient(otherWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: [],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              type: "auth.failed",
              occurred_at: nowIso,
              payload: { surface: "ws.upgrade" },
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
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(operatorWs.send).toHaveBeenCalledTimes(1);
    expect(otherWs.send).not.toHaveBeenCalled();
  });

  it("does not crash when auth claims include non-string scopes", async () => {
    const connectionManager = new ConnectionManager();
    const operatorWs = createMockWs();
    const badWs = createMockWs();
    connectionManager.addClient(operatorWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_operator_1",
        scopes: ["operator.read"],
      },
    });
    connectionManager.addClient(badWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_bad_1",
        scopes: [123],
      } as never,
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-1",
              type: "auth.failed",
              occurred_at: nowIso,
              payload: { surface: "ws.upgrade" },
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
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(operatorWs.send).toHaveBeenCalledTimes(1);
    expect(badWs.send).not.toHaveBeenCalled();
  });

  it("delivers auth audit events to admin-token clients", async () => {
    const connectionManager = new ConnectionManager();
    const adminWs = createMockWs();
    const otherWs = createMockWs();
    connectionManager.addClient(adminWs as never, ["cli"] as never, {
      role: "client",
      authClaims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
      },
    });
    connectionManager.addClient(otherWs as never, ["cli"] as never, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: [],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-1",
              type: "authz.denied",
              occurred_at: nowIso,
              payload: { surface: "http" },
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
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(adminWs.send).toHaveBeenCalledTimes(1);
    expect(otherWs.send).not.toHaveBeenCalled();
  });

  it("does not deliver auth audit events to admin-token nodes", async () => {
    const connectionManager = new ConnectionManager();
    const adminWs = createMockWs();
    connectionManager.addClient(adminWs as never, ["cli"] as never, {
      role: "node",
      authClaims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-1",
              type: "auth.failed",
              occurred_at: nowIso,
              payload: { surface: "ws.upgrade" },
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
    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(adminWs.send).not.toHaveBeenCalled();
  });

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

  it("filters ws.broadcast delivery using audience constraints", async () => {
    const connectionManager = new ConnectionManager();

    const wsAdmin = createMockWs();
    connectionManager.addClient(wsAdmin as never, ["cli"] as never, {
      id: "client-admin",
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        scopes: ["operator.admin"],
      },
    });

    const wsReadOnly = createMockWs();
    connectionManager.addClient(wsReadOnly as never, ["cli"] as never, {
      id: "client-readonly",
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        scopes: ["operator.read"],
      },
    });

    const wsNode = createMockWs();
    connectionManager.addClient(wsNode as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "node",
        scopes: ["*"],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-routing-1",
              type: "routing.config.updated",
              occurred_at: nowIso,
              scope: { kind: "global" },
              payload: { revision: 1, config: { v: 1 } },
            },
            audience: {
              roles: ["client"],
              required_scopes: ["operator.admin"],
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

    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(wsAdmin.send).toHaveBeenCalledTimes(1);
    expect(wsReadOnly.send).toHaveBeenCalledTimes(0);
    expect(wsNode.send).toHaveBeenCalledTimes(0);
  });

  it("fails closed when ws.broadcast audience is present but invalid", async () => {
    const connectionManager = new ConnectionManager();

    const wsAdmin = createMockWs();
    connectionManager.addClient(wsAdmin as never, ["cli"] as never, {
      id: "client-admin",
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        scopes: ["operator.admin"],
      },
    });

    const wsReadOnly = createMockWs();
    connectionManager.addClient(wsReadOnly as never, ["cli"] as never, {
      id: "client-readonly",
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        scopes: ["operator.read"],
      },
    });

    const wsNode = createMockWs();
    connectionManager.addClient(wsNode as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "node",
        scopes: ["*"],
      },
    });

    const nowIso = new Date().toISOString();
    const poll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          topic: "ws.broadcast",
          target_edge_id: null,
          payload: {
            message: {
              event_id: "evt-routing-1",
              type: "routing.config.updated",
              occurred_at: nowIso,
              scope: { kind: "global" },
              payload: { revision: 1, config: { v: 1 } },
            },
            audience: {
              roles: [],
              required_scopes: [],
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

    expect(ackConsumerCursor).toHaveBeenCalledWith("edge-a", 1);
    expect(wsAdmin.send).toHaveBeenCalledTimes(0);
    expect(wsReadOnly.send).toHaveBeenCalledTimes(0);
    expect(wsNode.send).toHaveBeenCalledTimes(0);
  });
});
