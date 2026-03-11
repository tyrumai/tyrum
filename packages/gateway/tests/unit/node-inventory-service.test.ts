import { descriptorIdForClientCapability } from "@tyrum/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { NodeInventoryService } from "../../src/modules/node/inventory-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "../integration/helpers.js";

describe("NodeInventoryService", () => {
  const cliDescriptor = { id: descriptorIdForClientCapability("cli"), version: "1.0.0" } as const;
  const containers: Array<Awaited<ReturnType<typeof createTestContainer>>> = [];

  afterEach(async () => {
    while (containers.length > 0) {
      await containers.pop()?.db.close();
    }
  });

  it("merges pairing metadata into connected standalone inventory rows", async () => {
    const container = await createTestContainer();
    containers.push(container);

    await container.nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-1",
      label: "Node One",
      capabilities: ["desktop"],
      metadata: { mode: "desktop", version: "1.2.3" },
      nowIso: "2026-03-08T00:00:00.000Z",
    });

    const connectionManager = new ConnectionManager();
    connectionManager.addClient(
      { on: vi.fn(), send: vi.fn(), readyState: 1 } as never,
      ["desktop"],
      {
        id: "conn-1",
        role: "node",
        deviceId: "node-1",
        authClaims: {
          token_kind: "device",
          token_id: "token-1",
          tenant_id: DEFAULT_TENANT_ID,
          device_id: "node-1",
          role: "node",
          scopes: [],
        },
        protocolRev: 2,
      },
    );

    const service = new NodeInventoryService({
      connectionManager,
      nodePairingDal: container.nodePairingDal,
    });

    const result = await service.list({
      tenantId: DEFAULT_TENANT_ID,
      dispatchableOnly: false,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        node_id: "node-1",
        label: "Node One",
        mode: "desktop",
        version: "1.2.3",
        connected: true,
      }),
    ]);
  });

  it("preserves pairing last-seen timestamps for offline nodes", async () => {
    const container = await createTestContainer();
    containers.push(container);

    const lastSeenAt = "2026-03-08T00:00:00.000Z";
    await container.nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-offline-1",
      label: "Offline Node",
      capabilities: ["desktop"],
      metadata: { mode: "desktop", version: "1.2.3" },
      nowIso: lastSeenAt,
    });

    const service = new NodeInventoryService({
      connectionManager: new ConnectionManager(),
      nodePairingDal: container.nodePairingDal,
    });

    const result = await service.list({
      tenantId: DEFAULT_TENANT_ID,
      dispatchableOnly: false,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        node_id: "node-offline-1",
        connected: false,
        last_seen_at: lastSeenAt,
      }),
    ]);
  });

  it("preserves connected non-catalog capabilities in node summaries", async () => {
    const connectionManager = new ConnectionManager();
    connectionManager.addClient(
      { on: vi.fn(), send: vi.fn(), readyState: 1 } as never,
      [cliDescriptor],
      {
        id: "conn-cli-1",
        role: "node",
        deviceId: "node-cli-1",
        authClaims: {
          token_kind: "device",
          token_id: "token-cli-1",
          tenant_id: DEFAULT_TENANT_ID,
          device_id: "node-cli-1",
          role: "node",
          scopes: [],
        },
        protocolRev: 2,
      },
    );

    const service = new NodeInventoryService({ connectionManager });
    const result = await service.list({
      tenantId: DEFAULT_TENANT_ID,
      dispatchableOnly: false,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      node_id: "node-cli-1",
      connected: true,
    });
    expect(result.nodes[0]?.capabilities).toContainEqual(
      expect.objectContaining({
        capability: descriptorIdForClientCapability("cli"),
        dispatchable: false,
        supported_action_count: 0,
        enabled_action_count: 0,
        available_action_count: 0,
        unknown_action_count: 0,
      }),
    );
  });
});
