import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

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

function addScopedNodeClient(
  cm: ConnectionManager,
  deviceId: string,
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const id = cm.addClient(
    ws as never,
    ["cli"] as never,
    {
      role: "node",
      deviceId,
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: `pairing:${deviceId}`,
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: deviceId,
        scopes: [],
      },
    } as never,
  );
  return { id, ws };
}

function addOperatorClient(cm: ConnectionManager): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const id = cm.addClient(
    ws as never,
    ["cli"] as never,
    {
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    } as never,
  );
  return { id, ws };
}

describe("scoped node WS authorization", () => {
  it("accepts capability.ready from scoped node tokens without operator scopes", async () => {
    const cm = new ConnectionManager();
    const { id: nodeId } = addScopedNodeClient(cm, "dev_scoped_node");
    const { ws: operatorWs } = addOperatorClient(cm);

    const result = await handleClientMessage(
      cm.getClient(nodeId)!,
      JSON.stringify({
        request_id: "r-cap-ready-scoped-node-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      { connectionManager: cm },
    );

    expect(result).toMatchObject({ request_id: "r-cap-ready-scoped-node-1", ok: true });
    const frames = operatorWs.send.mock.calls.map((call) => JSON.parse(call[0] as string)) as Array<
      Record<string, unknown>
    >;
    expect(
      frames.some(
        (msg) =>
          msg["type"] === "capability.ready" &&
          (msg["payload"] as { node_id?: string } | undefined)?.node_id === "dev_scoped_node",
      ),
    ).toBe(true);
  });

  it("forbids command.execute for scoped node tokens", async () => {
    const cm = new ConnectionManager();
    const { id } = addScopedNodeClient(cm, "dev_node_1");

    const result = await handleClientMessage(
      cm.getClient(id)!,
      JSON.stringify({
        request_id: "r-node-1",
        type: "command.execute",
        payload: { command: "/help" },
      }),
      { connectionManager: cm },
    );

    expect(result).toMatchObject({
      request_id: "r-node-1",
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("returns not_found for location.beacon when the explicit agent scope is missing", async () => {
    const cm = new ConnectionManager();
    const { id } = addScopedNodeClient(cm, "dev_node_2");
    const db = openTestSqliteDb();
    const locationService = new LocationService(db, {
      identityScopeDal: {
        ...({
          resolveAgentId: async (tenantId: string, agentKey: string) => {
            const row = await db.get<{ agent_id: string }>(
              "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ? LIMIT 1",
              [tenantId, agentKey],
            );
            return row?.agent_id ?? null;
          },
        } as const),
      } as never,
      memoryV1Dal: {
        createEpisode: vi.fn(),
      } as never,
    });

    try {
      const before = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const result = await handleClientMessage(
        cm.getClient(id)!,
        JSON.stringify({
          request_id: "r-node-location-1",
          type: "location.beacon",
          payload: {
            agent_key: "missing-agent",
            sample_id: "99999999-9999-4999-8999-999999999999",
            recorded_at: "2026-03-11T10:00:00.000Z",
            coords: {
              latitude: 52.3702,
              longitude: 4.8952,
              accuracy_m: 8,
            },
            source: "gps",
            is_background: false,
          },
        }),
        { connectionManager: cm, locationService },
      );

      expect(result).toMatchObject({
        request_id: "r-node-location-1",
        ok: false,
        error: { code: "not_found", message: "agent 'missing-agent' not found" },
      });

      const after = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(after?.count ?? 0).toBe(before?.count ?? 0);
    } finally {
      await db.close();
    }
  });
});
