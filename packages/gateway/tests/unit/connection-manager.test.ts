/**
 * ConnectionManager tests — verifies client tracking, capability routing,
 * heartbeat eviction, and stats computation.
 */

import { describe, expect, it, vi } from "vitest";
import {
  capabilityDescriptorsForClientCapability,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

// ---------------------------------------------------------------------------
// Mock WebSocket helper
// ---------------------------------------------------------------------------

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket & { emitPong: () => void } {
  const pongListeners: Array<() => void> = [];

  return {
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === "pong") pongListeners.push(listener);
      return undefined as never;
    }),
    readyState: 1, // OPEN
    emitPong: () => {
      for (const listener of pongListeners) listener();
    },
  };
}

function descriptorsFor(...capabilities: Array<"playwright" | "desktop" | "browser">) {
  return capabilities.flatMap((capability) => capabilityDescriptorsForClientCapability(capability));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionManager", () => {
  it("addClient returns a UUID and the client is retrievable", () => {
    const cm = new ConnectionManager();
    const ws = createMockWs();
    const id = cm.addClient(ws as never, descriptorsFor("playwright"));

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const client = cm.getClient(id);
    expect(client).toBeDefined();
    expect(client!.id).toBe(id);
    expect(client!.capabilities).toEqual(capabilityDescriptorsForClientCapability("playwright"));
  });

  it("removeClient evicts the client", () => {
    const cm = new ConnectionManager();
    const id = cm.addClient(createMockWs() as never, descriptorsFor("desktop"));
    cm.removeClient(id);

    expect(cm.getClient(id)).toBeUndefined();
    expect(cm.getStats().totalClients).toBe(0);
  });

  it("updates ws_connections_active on the injected registry", async () => {
    const metrics = new MetricsRegistry();
    metrics.wsConnectionsActive.set(0);
    const cm = new ConnectionManager(metrics);

    const id = cm.addClient(createMockWs() as never, descriptorsFor("desktop"), { id: "client-1" });
    await expect(
      metrics.registry.getSingleMetricAsString("ws_connections_active"),
    ).resolves.toMatch(/ws_connections_active\s+1(\s|$)/);

    cm.removeClient(id);
    await expect(
      metrics.registry.getSingleMetricAsString("ws_connections_active"),
    ).resolves.toMatch(/ws_connections_active\s+0(\s|$)/);
  });

  it("getClientForCapability returns matching client", () => {
    const cm = new ConnectionManager();
    cm.addClient(createMockWs() as never, descriptorsFor("playwright"));
    cm.addClient(createMockWs() as never, descriptorsFor("desktop", "playwright"));

    const playwrightClient = cm.getClientForCapability(
      descriptorIdForClientCapability("playwright"),
    );
    expect(playwrightClient).toBeDefined();
    expect(playwrightClient!.capabilities).toContainEqual({
      id: descriptorIdForClientCapability("playwright"),
      version: "1.0.0",
    });

    const cliClient = cm.getClientForCapability(descriptorIdForClientCapability("playwright"));
    expect(cliClient).toBeDefined();
    expect(cliClient!.capabilities).toContainEqual({
      id: descriptorIdForClientCapability("playwright"),
      version: "1.0.0",
    });

    const httpClient = cm.getClientForCapability(descriptorIdForClientCapability("playwright"));
    expect(httpClient).toBeDefined();
    expect(httpClient!.capabilities).toContainEqual({
      id: descriptorIdForClientCapability("playwright"),
      version: "1.0.0",
    });
  });

  it("getClientForCapability returns undefined when no match", () => {
    const cm = new ConnectionManager();
    cm.addClient(createMockWs() as never, descriptorsFor("playwright"));

    expect(cm.getClientForCapability("tyrum.android.location.get-current")).toBeUndefined();
  });

  it("broadcastToCapable sends to all matching clients", () => {
    const cm = new ConnectionManager();
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const ws3 = createMockWs();

    cm.addClient(ws1 as never, descriptorsFor("playwright"));
    cm.addClient(ws2 as never, descriptorsFor("playwright", "desktop"));
    cm.addClient(ws3 as never, descriptorsFor("desktop"));

    cm.broadcastToCapable(descriptorIdForClientCapability("playwright"), {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();
    expect(ws3.send).not.toHaveBeenCalled();

    const sent = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toEqual({
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });
  });

  it("normalizes dispatched attempt ids for lookup", () => {
    const cm = new ConnectionManager();

    cm.recordDispatchedAttemptExecutor("attempt-1", "dev_test");

    expect(cm.getDispatchedAttemptExecutor("attempt-1")).toBe("dev_test");
    expect(cm.getDispatchedAttemptExecutor("  attempt-1  ")).toBe("dev_test");
  });

  describe("heartbeat", () => {
    it("sends WebSocket ping control frames to all connected clients", () => {
      const cm = new ConnectionManager();
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      cm.addClient(ws1 as never, descriptorsFor("playwright"));
      cm.addClient(ws2 as never, descriptorsFor("desktop"));

      cm.heartbeat();

      expect(ws1.ping).toHaveBeenCalledOnce();
      expect(ws2.ping).toHaveBeenCalledOnce();
    });

    it("evicts clients that have not ponged within timeout", () => {
      const cm = new ConnectionManager();
      const ws = createMockWs();
      const id = cm.addClient(ws as never, descriptorsFor("playwright"));

      // Simulate a stale client by setting the WS pong timestamp to the past.
      const client = cm.getClient(id);
      expect(client).toBeDefined();
      client!.lastWsPongAt = Date.now() - 20_000; // 20 seconds ago

      cm.heartbeat();

      expect(ws.terminate).toHaveBeenCalledOnce();
      expect(cm.getClient(id)).toBeUndefined();
      expect(cm.getStats().totalClients).toBe(0);
    });

    it("keeps fresh clients alive", () => {
      const cm = new ConnectionManager();
      const ws = createMockWs();
      const id = cm.addClient(ws as never, descriptorsFor("playwright"));

      // Client just ponged.
      const client = cm.getClient(id);
      expect(client).toBeDefined();
      client!.lastWsPongAt = Date.now();

      cm.heartbeat();

      expect(ws.terminate).not.toHaveBeenCalled();
      expect(ws.ping).toHaveBeenCalledOnce();
      expect(cm.getClient(id)).toBeDefined();
    });

    it("updates lastWsPongAt on websocket pong frames", () => {
      const cm = new ConnectionManager();
      const ws = createMockWs();
      const id = cm.addClient(ws as never, descriptorsFor("playwright"));
      const client = cm.getClient(id);
      expect(client).toBeDefined();

      client!.lastWsPongAt = 1000;
      const before = Date.now();
      ws.emitPong();
      const after = Date.now();

      expect(client!.lastWsPongAt).toBeGreaterThanOrEqual(before);
      expect(client!.lastWsPongAt).toBeLessThanOrEqual(after);
    });
  });

  describe("getStats", () => {
    it("returns correct totals and capability counts", () => {
      const cm = new ConnectionManager();
      cm.addClient(createMockWs() as never, descriptorsFor("playwright", "desktop"));
      cm.addClient(createMockWs() as never, descriptorsFor("playwright"));
      cm.addClient(createMockWs() as never, descriptorsFor("desktop"));

      const stats = cm.getStats();
      expect(stats.totalClients).toBe(3);
      expect(stats.capabilityCounts[descriptorIdForClientCapability("playwright")]).toBe(2);
      expect(stats.capabilityCounts["tyrum.desktop.screenshot"]).toBe(2);
    });

    it("returns zero counts when empty", () => {
      const cm = new ConnectionManager();
      const stats = cm.getStats();
      expect(stats.totalClients).toBe(0);
      expect(stats.capabilityCounts).toEqual({});
    });
  });

  it("allClients iterates all clients", () => {
    const cm = new ConnectionManager();
    const id1 = cm.addClient(createMockWs() as never, descriptorsFor("playwright"));
    const id2 = cm.addClient(createMockWs() as never, descriptorsFor("desktop"));

    const ids = [...cm.allClients()].map((c) => c.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toHaveLength(2);
  });
});
