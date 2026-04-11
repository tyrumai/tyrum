import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createHeartbeatController } from "../../src/routes/ws/heartbeat.js";

describe("WS heartbeat controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("touches cluster and presence backends and broadcasts pruned presence", async () => {
    vi.useFakeTimers();

    const sameTenantClientSend = vi.fn();
    const sameTenantNodeSend = vi.fn();
    const otherTenantClientSend = vi.fn();
    const heartbeat = vi.fn();
    const allClients = vi.fn(() => [
      {
        id: "conn-1",
        role: "client",
        device_id: "shared-device",
        auth_claims: { tenant_id: "tenant-1", token_kind: "admin", scopes: ["*"] },
        ws: { send: sameTenantClientSend },
      },
      {
        id: "conn-2",
        role: "node",
        device_id: "shared-device",
        auth_claims: { tenant_id: "tenant-1", token_kind: "device", scopes: [] },
        ws: { send: sameTenantNodeSend },
      },
      {
        id: "conn-3",
        role: "client",
        device_id: "shared-device",
        auth_claims: { tenant_id: "tenant-2", token_kind: "admin", scopes: ["*"] },
        ws: { send: otherTenantClientSend },
      },
    ]);

    const connectionManager = {
      heartbeat,
      allClients,
    } as unknown as ConnectionManager;

    const touchConnection = vi.fn(async () => undefined);
    const cleanupExpired = vi.fn(async () => 0);
    const touchPresence = vi.fn(async () => undefined);
    const pruneExpired = vi.fn(async () => [
      { tenant_id: "tenant-1", instance_id: "device-pruned" },
    ]);
    const enforceCap = vi.fn(async () => []);

    const { stopHeartbeat } = createHeartbeatController({
      connectionManager,
      cluster: {
        instanceId: "edge-1",
        connectionDirectory: {
          touchConnection,
          cleanupExpired,
        } as never,
      },
      connectionTtlMs: 30_000,
      presenceDal: {
        touch: touchPresence,
        pruneExpired,
        enforceCap,
      } as never,
      presenceTtlMs: 60_000,
      presenceMaxEntries: 500,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(heartbeat).toHaveBeenCalledOnce();
    expect(touchConnection).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      connectionId: "conn-1",
      nowMs: expect.any(Number),
      ttlMs: 30_000,
    });
    expect(cleanupExpired).toHaveBeenCalledWith(expect.any(Number));
    expect(touchPresence).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant-1",
      instanceId: "shared-device",
      nowMs: expect.any(Number),
      ttlMs: 60_000,
    });
    expect(touchPresence).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant-1",
      instanceId: "shared-device",
      nowMs: expect.any(Number),
      ttlMs: 60_000,
    });
    expect(pruneExpired).toHaveBeenCalledWith(expect.any(Number));
    expect(enforceCap).toHaveBeenCalledWith(500);

    expect(sameTenantClientSend).toHaveBeenCalledOnce();
    expect(sameTenantNodeSend).not.toHaveBeenCalled();
    expect(otherTenantClientSend).not.toHaveBeenCalled();

    const payload = JSON.parse(sameTenantClientSend.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(payload["type"]).toBe("presence.pruned");
    expect(payload["payload"]).toEqual({ instance_id: "device-pruned" });

    stopHeartbeat();
  });

  it("stops scheduling future heartbeat ticks", async () => {
    vi.useFakeTimers();

    const heartbeat = vi.fn();
    const connectionManager = {
      heartbeat,
      allClients: () => [],
    } as unknown as ConnectionManager;

    const { stopHeartbeat } = createHeartbeatController({
      connectionManager,
      connectionTtlMs: 30_000,
      presenceTtlMs: 60_000,
      presenceMaxEntries: 500,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    stopHeartbeat();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(heartbeat).toHaveBeenCalledTimes(1);
  });
});
