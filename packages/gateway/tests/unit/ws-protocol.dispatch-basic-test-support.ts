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
  runId: "550e8400-e29b-41d4-a716-446655440000",
  stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
  attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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

    const taskId = await dispatchTask(action, defaultDispatchScope, deps);
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      request_id: taskId,
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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

    const taskId = await dispatchTask(cliCommandAction, defaultDispatchScope, deps);
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(cm.getDispatchedAttemptExecutor("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e")).toBe(
      "dev_test",
    );
  });
}

function registerMetadataPersistenceTests(): void {
  it("persists execution attempt executor metadata when dispatching to a node", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO execution_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           key,
           lane,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "main",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "main",
          "running",
          1,
        ],
      );
      await db.run(
        `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          1,
          "running",
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

      await dispatchTask(cliCommandAction, defaultDispatchScope, deps);

      const row = await db.get<{ metadata_json: string | null }>(
        "SELECT metadata_json FROM execution_attempts WHERE attempt_id = ?",
        ["0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e"],
      );
      expect(row).toBeDefined();
      const meta = JSON.parse(row!.metadata_json ?? "{}") as {
        executor?: { kind?: string; node_id?: string; connection_id?: string };
      };
      expect(meta.executor?.kind).toBe("node");
      expect(meta.executor?.node_id).toBe("dev_test");
      expect(meta.executor?.connection_id).toBe("node-1");
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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
