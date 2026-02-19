/**
 * ConnectionManager tests — verifies client tracking, capability routing,
 * heartbeat eviction, and stats computation.
 */

import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

// ---------------------------------------------------------------------------
// Mock WebSocket helper
// ---------------------------------------------------------------------------

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionManager", () => {
  it("addClient returns a UUID and the client is retrievable", () => {
    const cm = new ConnectionManager();
    const ws = createMockWs();
    const id = cm.addClient(ws as never, ["playwright"]);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const client = cm.getClient(id);
    expect(client).toBeDefined();
    expect(client!.id).toBe(id);
    expect(client!.capabilities).toEqual(["playwright"]);
  });

  it("removeClient evicts the client", () => {
    const cm = new ConnectionManager();
    const id = cm.addClient(createMockWs() as never, ["cli"]);
    cm.removeClient(id);

    expect(cm.getClient(id)).toBeUndefined();
    expect(cm.getStats().totalClients).toBe(0);
  });

  it("getClientForCapability returns matching client", () => {
    const cm = new ConnectionManager();
    cm.addClient(createMockWs() as never, ["playwright"]);
    cm.addClient(createMockWs() as never, ["cli", "http"]);

    const playwrightClient = cm.getClientForCapability("playwright");
    expect(playwrightClient).toBeDefined();
    expect(playwrightClient!.capabilities).toContain("playwright");

    const cliClient = cm.getClientForCapability("cli");
    expect(cliClient).toBeDefined();
    expect(cliClient!.capabilities).toContain("cli");

    const httpClient = cm.getClientForCapability("http");
    expect(httpClient).toBeDefined();
    expect(httpClient!.capabilities).toContain("http");
  });

  it("getClientForCapability returns undefined when no match", () => {
    const cm = new ConnectionManager();
    cm.addClient(createMockWs() as never, ["playwright"]);

    expect(cm.getClientForCapability("android")).toBeUndefined();
  });

  it("broadcastToCapable sends to all matching clients", () => {
    const cm = new ConnectionManager();
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const ws3 = createMockWs();

    cm.addClient(ws1 as never, ["playwright"]);
    cm.addClient(ws2 as never, ["playwright", "cli"]);
    cm.addClient(ws3 as never, ["cli"]);

    cm.broadcastToCapable("playwright", {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();
    expect(ws3.send).not.toHaveBeenCalled();

    const sent = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toEqual({
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });
  });

  describe("heartbeat", () => {
    it("sends ping to all connected clients", () => {
      const cm = new ConnectionManager();
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      cm.addClient(ws1 as never, ["playwright"]);
      cm.addClient(ws2 as never, ["cli"]);

      cm.heartbeat();

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();

      const ping = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >;
      expect(ping["type"]).toBe("ping");
      expect(typeof ping["request_id"]).toBe("string");
      expect(ping["payload"]).toEqual({});
    });

    it("evicts clients that have not ponged within timeout", () => {
      const cm = new ConnectionManager();
      const ws = createMockWs();
      const id = cm.addClient(ws as never, ["playwright"]);

      // Simulate a stale client by setting lastPong to the past.
      const client = cm.getClient(id);
      expect(client).toBeDefined();
      client!.lastPong = Date.now() - 20_000; // 20 seconds ago

      cm.heartbeat();

      expect(ws.close).toHaveBeenCalledOnce();
      expect(cm.getClient(id)).toBeUndefined();
      expect(cm.getStats().totalClients).toBe(0);
    });

    it("keeps fresh clients alive", () => {
      const cm = new ConnectionManager();
      const ws = createMockWs();
      const id = cm.addClient(ws as never, ["playwright"]);

      // Client just ponged.
      const client = cm.getClient(id);
      expect(client).toBeDefined();
      client!.lastPong = Date.now();

      cm.heartbeat();

      expect(ws.close).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledOnce(); // ping sent
      expect(cm.getClient(id)).toBeDefined();
    });
  });

  describe("getStats", () => {
    it("returns correct totals and capability counts", () => {
      const cm = new ConnectionManager();
      cm.addClient(createMockWs() as never, ["playwright", "cli"]);
      cm.addClient(createMockWs() as never, ["playwright"]);
      cm.addClient(createMockWs() as never, ["http"]);

      const stats = cm.getStats();
      expect(stats.totalClients).toBe(3);
      expect(stats.capabilityCounts).toEqual({
        playwright: 2,
        cli: 1,
        http: 1,
      });
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
    const id1 = cm.addClient(createMockWs() as never, ["playwright"]);
    const id2 = cm.addClient(createMockWs() as never, ["cli"]);

    const ids = [...cm.allClients()].map((c) => c.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toHaveLength(2);
  });
});
