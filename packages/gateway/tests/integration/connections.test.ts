import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createConnectionsRoute } from "../../src/routes/connections.js";

describe("GET /connections", () => {
  const connectionManager = new ConnectionManager();
  const app = new Hono();
  app.route("/", createConnectionsRoute(connectionManager));

  it("returns 200 with empty stats when no clients are connected", async () => {
    const res = await app.request("/connections");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalClients: number; capabilityCounts: Record<string, number> };
    expect(body).toEqual({ totalClients: 0, capabilityCounts: {} });
  });
});
