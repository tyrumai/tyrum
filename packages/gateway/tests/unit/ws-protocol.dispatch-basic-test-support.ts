import { expect, it, vi } from "vitest";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION, type ActionPrimitive } from "@tyrum/contracts";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, handleClientMessage } from "../../src/ws/protocol.js";
import { NoCapableNodeError, NodeNotPairedError } from "../../src/ws/protocol/errors.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { createMockWs, makeDeps, makeClient } from "./ws-protocol.test-support.js";

const cliDescriptor = {
  id: "tyrum.desktop.screenshot",
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
} as const;
const browserNavigateDescriptor = {
  id: "tyrum.browser.navigate",
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
} as const;
const desktopSnapshotDescriptor = {
  id: "tyrum.desktop.snapshot",
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
} as const;
const defaultDispatchScope = {
  tenantId: DEFAULT_TENANT_ID,
  turnId: "550e8400-e29b-41d4-a716-446655440000",
} as const;
const cliCommandAction: ActionPrimitive = {
  type: "Desktop",
  args: { op: "screenshot" },
};

/**
 * Basic dispatchTask tests — pairing, readiness, metadata persistence, and cluster filtering.
 * Must be called inside a `describe("dispatchTask")` block.
 */
function registerSelectionTests(): void {
  it("never selects a capability-providing client for task.execute", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, [cliDescriptor], { protocolRev: 2 });
    const deps = makeDeps(cm);

    await expect(dispatchTask(cliCommandAction, defaultDispatchScope, deps)).rejects.toBeInstanceOf(
      NoCapableNodeError,
    );
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("sends task.execute request to a paired capable node", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, [browserNavigateDescriptor], {
      role: "node",
      deviceId: "dev_web_test",
      protocolRev: 2,
    });
    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: browserNavigateDescriptor.id,
                version: browserNavigateDescriptor.version,
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "Web",
      args: { op: "navigate", url: "https://example.com" },
    };

    const dispatched = await dispatchTask(action, defaultDispatchScope, deps);
    const { taskId, dispatchId } = dispatched;
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      request_id: taskId,
      type: "task.execute",
      payload: {
        turn_id: "550e8400-e29b-41d4-a716-446655440000",
        dispatch_id: dispatchId,
        action: { type: "Web", args: { op: "navigate", url: "https://example.com" } },
      },
    });
  });

  it("dispatches to a paired node before it signals readiness (backward-compatible)", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
    });

    const dispatched = await dispatchTask(cliCommandAction, defaultDispatchScope, deps);
    const { taskId, dispatchId } = dispatched;
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(cm.getDispatchedDispatchExecutor(dispatchId)).toBe("dev_test");
  });
}

function registerMetadataPersistenceTests(): void {
  it("persists execution attempt executor metadata when dispatching to a node", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO turn_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           conversation_key,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "running",
          1,
        ],
      );
      const cm = new ConnectionManager();
      const nodeWs = createMockWs();
      cm.addClient(nodeWs as never, [cliDescriptor] as never, {
        id: "node-1",
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-node-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "node",
          device_id: "dev_test",
          scopes: [],
        },
      });

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () =>
            ({
              status: "approved",
              capability_allowlist: [
                {
                  id: cliDescriptor.id,
                  version: cliDescriptor.version,
                },
              ],
            }) as never,
        } as never,
      });

      const dispatched = await dispatchTask(cliCommandAction, defaultDispatchScope, deps);

      const row = await db.get<{
        requested_node_id: string | null;
        selected_node_id: string | null;
        connection_id: string | null;
        turn_id: string | null;
        task_id: string | null;
      }>(
        `SELECT
           requested_node_id,
           selected_node_id,
           connection_id,
           turn_id,
           task_id
         FROM dispatch_records
         WHERE tenant_id = ? AND dispatch_id = ?`,
        [DEFAULT_TENANT_ID, dispatched.dispatchId],
      );
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        requested_node_id: null,
        selected_node_id: "dev_test",
        connection_id: "node-1",
        turn_id: "550e8400-e29b-41d4-a716-446655440000",
        task_id: dispatched.taskId,
      });
    } finally {
      await db.close();
    }
  });
}

function registerReadinessAndClusterTests(): void {
  it("stops dispatching to a paired node when it reports readiness removed", async () => {
    const cm = new ConnectionManager();
    const { ws: nodeWs } = makeClient(cm, [cliDescriptor], {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: cliDescriptor.id,
              version: cliDescriptor.version,
            },
          ],
        },
      }),
      deps,
    );
    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-2",
        type: "capability.ready",
        payload: { capabilities: [] },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    await expect(dispatchTask(cliCommandAction, defaultDispatchScope, deps)).rejects.toBeInstanceOf(
      NoCapableNodeError,
    );
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("filters cluster directory entries by protocol_rev >= 2", async () => {
    const cm = new ConnectionManager();
    const outboxDal = { enqueue: vi.fn(async () => undefined) };
    const connectionDirectory = {
      listConnectionsForCapability: vi.fn(async () => {
        return [
          {
            connection_id: "conn-v1",
            edge_id: "edge-a",
            role: "node",
            protocol_rev: 1,
            device_id: "dev-1",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: [cliDescriptor],
            ready_capabilities: [cliDescriptor],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
          {
            connection_id: "conn-v2",
            edge_id: "edge-a",
            role: "node",
            protocol_rev: 2,
            device_id: "dev-2",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: [cliDescriptor],
            ready_capabilities: [cliDescriptor],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
        ];
      }),
    };

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
      cluster: {
        edgeId: "edge-b",
        outboxDal: outboxDal as never,
        connectionDirectory: connectionDirectory as never,
      },
    });

    await dispatchTask({ type: "Desktop", args: { op: "screenshot" } }, defaultDispatchScope, deps);

    expect(outboxDal.enqueue).toHaveBeenCalledOnce();
    const payload = outboxDal.enqueue.mock.calls[0]![2] as {
      connection_id: string;
    };
    expect(payload.connection_id).toBe("conn-v2");
  });

  it("does not dispatch to an unpaired node", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    await expect(dispatchTask(cliCommandAction, defaultDispatchScope, deps)).rejects.toBeInstanceOf(
      NodeNotPairedError,
    );
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("throws NodeNotPairedError when local node is unpaired and cluster has no candidates", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [desktopSnapshotDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const outboxDal = { enqueue: vi.fn(async () => undefined) };
    const connectionDirectory = {
      listConnectionsForCapability: vi.fn(async () => []),
    };

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
      cluster: {
        edgeId: "edge-local",
        outboxDal: outboxDal as never,
        connectionDirectory: connectionDirectory as never,
      },
    });

    await expect(
      dispatchTask(
        { type: "Desktop", args: { op: "snapshot" } },
        {
          tenantId: DEFAULT_TENANT_ID,
          turnId: "550e8400-e29b-41d4-a716-446655440000",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(outboxDal.enqueue).not.toHaveBeenCalled();
  });
}

export function registerDispatchBasicTests(): void {
  registerSelectionTests();
  registerMetadataPersistenceTests();
  registerReadinessAndClusterTests();
}
