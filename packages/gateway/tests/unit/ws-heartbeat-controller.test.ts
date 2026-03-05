import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createHeartbeatController } from "../../src/routes/ws/heartbeat.js";

describe("WS heartbeat controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("touches cluster and presence backends and broadcasts pruned presence", async () => {
    vi.useFakeTimers();

    const peerOneSend = vi.fn();
    const peerTwoSend = vi.fn();
    const heartbeat = vi.fn();
    const allClients = vi.fn(() => [
      {
        id: "conn-1",
        device_id: "device-1",
        auth_claims: { tenant_id: "tenant-1" },
        ws: { send: peerOneSend },
      },
      {
        id: "conn-2",
        device_id: undefined,
        auth_claims: undefined,
        ws: { send: peerTwoSend },
      },
    ]);

    const connectionManager = {
      heartbeat,
      allClients,
    } as unknown as ConnectionManager;

    const touchConnection = vi.fn(async () => undefined);
    const cleanupExpired = vi.fn(async () => 0);
    const touchPresence = vi.fn(async () => undefined);
    const pruneExpired = vi.fn(async () => ["device-pruned"]);
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
    expect(touchPresence).toHaveBeenCalledWith({
      instanceId: "device-1",
      nowMs: expect.any(Number),
      ttlMs: 60_000,
    });
    expect(pruneExpired).toHaveBeenCalledWith(expect.any(Number));
    expect(enforceCap).toHaveBeenCalledWith(500);

    expect(peerOneSend).toHaveBeenCalledOnce();
    expect(peerTwoSend).toHaveBeenCalledOnce();

    const payload = JSON.parse(peerOneSend.mock.calls[0]![0] as string) as Record<string, unknown>;
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
