import { vi } from "vitest";
import {
  OutboxPoller,
  type OutboxPollerOptions,
} from "../../src/modules/backplane/outbox-poller.js";
import type { OutboxDal, OutboxRow } from "../../src/modules/backplane/outbox-dal.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";

export interface MockWebSocket {
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
  terminate: ReturnType<typeof vi.fn>;
}

type ClientOptions = Parameters<ConnectionManager["addClient"]>[2];
type ClientCapabilities = Parameters<ConnectionManager["addClient"]>[1];
type PollerOverrides = Partial<
  Omit<OutboxPollerOptions, "consumerId" | "connectionManager" | "outboxDal">
>;

export type ClientSpec = {
  key: string;
  capabilities?: ClientCapabilities;
  options?: ClientOptions;
  wsOptions?: {
    bufferedAmount?: number;
    readyState?: number;
  };
};

type SocketScenario = {
  ackConsumerCursor: ReturnType<typeof vi.fn>;
  connectionManager: ConnectionManager;
  poller: OutboxPoller;
  sockets: Record<string, MockWebSocket>;
};

type SlowConsumerScenario = {
  ackConsumerCursor: ReturnType<typeof vi.fn>;
  connectionManager: ConnectionManager;
  healthyWs: MockWebSocket;
  logger: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  metrics: MetricsRegistry;
  poller: OutboxPoller;
  slowWs: MockWebSocket;
};

type DirectDeliveryScenario = {
  connectionManager: ConnectionManager;
  poller: OutboxPoller;
  taskResults: TaskResultRegistry;
  ws: MockWebSocket;
};

type SlowDirectDeliveryScenario = {
  ackConsumerCursor: ReturnType<typeof vi.fn>;
  attemptId: string;
  connectionManager: ConnectionManager;
  logger: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  metrics: MetricsRegistry;
  poller: OutboxPoller;
  ws: MockWebSocket;
};

type RetryScenario = {
  ackConsumerCursor: ReturnType<typeof vi.fn>;
  poller: OutboxPoller;
  ws: MockWebSocket;
};

type ClusterTaskResultRelayScenario = {
  ackConsumerCursor: ReturnType<typeof vi.fn>;
  poller: OutboxPoller;
  taskResults: TaskResultRegistry;
};

function createMockWs(options?: ClientSpec["wsOptions"]): MockWebSocket {
  return {
    bufferedAmount: options?.bufferedAmount ?? 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: options?.readyState ?? 1,
    terminate: vi.fn(),
  };
}

function createOutboxRow({
  id = 1,
  payload,
  topic,
}: {
  id?: number;
  payload: unknown;
  topic: string;
}): OutboxRow {
  const nowIso = new Date().toISOString();
  return {
    id,
    tenant_id: DEFAULT_TENANT_ID,
    topic,
    target_edge_id: null,
    payload,
    created_at: nowIso,
  };
}

function createOutboxPollerHarness({
  connectionManager,
  pollResults,
  pollerOverrides,
}: {
  connectionManager: ConnectionManager;
  pollResults: readonly OutboxRow[][];
  pollerOverrides?: PollerOverrides;
}) {
  const poll = vi.fn();
  for (const rows of pollResults) {
    poll.mockResolvedValueOnce(rows);
  }

  const ackConsumerCursor = vi.fn(async () => undefined);
  const outboxDal = {
    listActiveTenantIds: vi.fn(async () => [DEFAULT_TENANT_ID]),
    poll,
    ackConsumerCursor,
  } as unknown as OutboxDal;

  const poller = new OutboxPoller({
    consumerId: "edge-a",
    outboxDal,
    connectionManager,
    ...pollerOverrides,
  });

  return { ackConsumerCursor, poller };
}

function attachClients(
  connectionManager: ConnectionManager,
  clients: readonly ClientSpec[],
): Record<string, MockWebSocket> {
  const sockets: Record<string, MockWebSocket> = {};

  for (const client of clients) {
    const ws = createMockWs(client.wsOptions);
    connectionManager.addClient(
      ws as never,
      (client.capabilities ?? ["desktop"]) as never,
      client.options,
    );
    sockets[client.key] = ws;
  }

  return sockets;
}

export function createBroadcastScenario({
  clients,
  payload,
  pollerOverrides,
}: {
  clients: readonly ClientSpec[];
  payload: unknown;
  pollerOverrides?: PollerOverrides;
}): SocketScenario {
  const connectionManager = new ConnectionManager();
  const sockets = attachClients(connectionManager, clients);
  const { ackConsumerCursor, poller } = createOutboxPollerHarness({
    connectionManager,
    pollResults: [[createOutboxRow({ topic: "ws.broadcast", payload })], []],
    pollerOverrides,
  });

  return { ackConsumerCursor, connectionManager, poller, sockets };
}

function createDirectScenario({
  clients,
  payload,
  pollerOverrides,
  taskResults,
}: {
  clients: readonly ClientSpec[];
  payload: unknown;
  pollerOverrides?: PollerOverrides;
  taskResults?: TaskResultRegistry;
}): SocketScenario {
  const connectionManager = new ConnectionManager();
  const sockets = attachClients(connectionManager, clients);
  const { ackConsumerCursor, poller } = createOutboxPollerHarness({
    connectionManager,
    pollResults: [[createOutboxRow({ topic: "ws.direct", payload })], []],
    pollerOverrides: {
      ...pollerOverrides,
      ...(taskResults ? { taskResults } : {}),
    },
  });

  return { ackConsumerCursor, connectionManager, poller, sockets };
}
function createPlanUpdateMessage() {
  return {
    event_id: "evt-1",
    type: "plan.update",
    occurred_at: new Date().toISOString(),
    payload: { plan_id: "p1", status: "running" },
  };
}

function createTaskExecuteMessage(dispatchId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e") {
  return {
    request_id: "task-1",
    type: "task.execute",
    payload: {
      turn_id: "550e8400-e29b-41d4-a716-446655440000",
      dispatch_id: dispatchId,
      action: { type: "Desktop", args: { op: "screenshot" } },
    },
  };
}

function adminClient({
  id,
  key,
  tokenId,
  wsOptions,
}: {
  id?: string;
  key: string;
  tokenId: string;
  wsOptions?: ClientSpec["wsOptions"];
}): ClientSpec {
  return {
    key,
    wsOptions,
    options: {
      ...(id ? { id } : {}),
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: tokenId,
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    },
  };
}

function taskNode({
  id = "node-1",
  key = "node",
  tokenId = "token-node-1",
  wsOptions,
}: {
  id?: string;
  key?: string;
  tokenId?: string;
  wsOptions?: ClientSpec["wsOptions"];
} = {}): ClientSpec {
  return {
    key,
    wsOptions,
    options: {
      id,
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: tokenId,
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: ["*"],
      },
    },
  };
}

export function createSlowBroadcastDeliveryScenario(): SlowConsumerScenario {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const metrics = new MetricsRegistry();
  const connectionManager = new ConnectionManager();
  const sockets = attachClients(connectionManager, [
    adminClient({
      key: "slow",
      id: "slow-client",
      tokenId: "token-slow",
      wsOptions: { bufferedAmount: 11 },
    }),
    adminClient({
      key: "healthy",
      id: "healthy-client",
      tokenId: "token-healthy",
    }),
  ]);
  const { ackConsumerCursor, poller } = createOutboxPollerHarness({
    connectionManager,
    pollResults: [
      [
        createOutboxRow({
          topic: "ws.broadcast",
          payload: {
            message: createPlanUpdateMessage(),
          },
        }),
      ],
      [],
    ],
    pollerOverrides: {
      logger: logger as never,
      maxBufferedBytes: 10,
      metrics,
    },
  });

  return {
    ackConsumerCursor,
    connectionManager,
    healthyWs: sockets.healthy,
    logger,
    metrics,
    poller,
    slowWs: sockets.slow,
  };
}

export function createRetryOnProcessingErrorScenario(): RetryScenario {
  const connectionManager = new ConnectionManager();
  const sockets = attachClients(connectionManager, [
    adminClient({ key: "client", tokenId: "token-client-1" }),
  ]);
  const circular: Record<string, unknown> = {};
  circular["self"] = circular;

  const { ackConsumerCursor, poller } = createOutboxPollerHarness({
    connectionManager,
    pollResults: [
      [
        createOutboxRow({
          topic: "ws.broadcast",
          payload: { message: circular },
        }),
      ],
      [
        createOutboxRow({
          topic: "ws.broadcast",
          payload: {
            message: createPlanUpdateMessage(),
          },
        }),
      ],
      [],
    ],
  });

  return { ackConsumerCursor, poller, ws: sockets.client };
}

export function createTaskExecuteDeliveryScenario(): DirectDeliveryScenario {
  const taskResults = new TaskResultRegistry();
  const { connectionManager, poller, sockets } = createDirectScenario({
    clients: [taskNode()],
    payload: {
      connection_id: "node-1",
      message: createTaskExecuteMessage(),
    },
    taskResults,
  });

  return { connectionManager, poller, taskResults, ws: sockets.node };
}

export function createSlowDirectDeliveryScenario(): SlowDirectDeliveryScenario {
  const attemptId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
  const logger = { warn: vi.fn(), error: vi.fn() };
  const metrics = new MetricsRegistry();
  const { ackConsumerCursor, connectionManager, poller, sockets } = createDirectScenario({
    clients: [taskNode({ wsOptions: { bufferedAmount: 11 } })],
    payload: {
      connection_id: "node-1",
      message: createTaskExecuteMessage(attemptId),
    },
    pollerOverrides: {
      logger: logger as never,
      maxBufferedBytes: 10,
      metrics,
    },
  });

  return {
    ackConsumerCursor,
    attemptId,
    connectionManager,
    logger,
    metrics,
    poller,
    ws: sockets.node,
  };
}

export function createClusterTaskResultRelayScenario(): ClusterTaskResultRelayScenario {
  const taskResults = new TaskResultRegistry();
  const connectionManager = new ConnectionManager();
  const { ackConsumerCursor, poller } = createOutboxPollerHarness({
    connectionManager,
    pollResults: [
      [
        createOutboxRow({
          topic: "ws.cluster.task_result",
          payload: {
            task_id: "task-1",
            task_result: { ok: true, evidence: { foo: "bar" } },
          },
        }),
      ],
      [],
    ],
    pollerOverrides: {
      taskResults,
    },
  });

  return { ackConsumerCursor, poller, taskResults };
}
