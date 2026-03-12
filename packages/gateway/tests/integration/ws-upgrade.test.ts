/**
 * WebSocket upgrade integration test.
 *
 * Verifies that:
 * 1. A WebSocket client can connect to ws://localhost:<port>/ws with auth metadata
 * 2. The hello handshake completes successfully
 * 3. ConnectionManager reports the connected client with correct capabilities
 * 4. Non-/ws upgrade requests are rejected (socket destroyed)
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { descriptorIdForClientCapability } from "@tyrum/schemas";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

let activeDb: SqliteDb | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start a real HTTP server with WebSocket upgrade on a random port. */
async function startServer(app: Hono): Promise<{
  server: Server;
  port: number;
  adminToken: string;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
}> {
  const connectionManager = new ConnectionManager();
  const db = openTestSqliteDb();
  activeDb = db;
  const authTokens = new AuthTokenService(db);
  const adminToken = (
    await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
  ).token;

  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps: { connectionManager },
    authTokens,
  });

  const requestListener = getRequestListener(app.fetch);
  const server = createServer(requestListener);

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });

  return { server, port, adminToken, connectionManager, stopHeartbeat };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket upgrade", () => {
  let httpServer: Server | undefined;
  let client: TyrumClient | undefined;
  let stopHeartbeat: (() => void) | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
    await activeDb?.close();
    activeDb = undefined;
  });

  it("connects via WebSocket and completes hello handshake", async () => {
    const app = new Hono().get("/healthz", (c) => c.json({ status: "ok" }));
    const srv = await startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: srv.adminToken,
      capabilities: ["playwright", "http"],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await connectedP;

    expect(client.connected).toBe(true);

    // Allow the server time to register the client after hello
    await delay(50);

    const stats = srv.connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts[descriptorIdForClientCapability("playwright")]).toBe(1);
    expect(stats.capabilityCounts[descriptorIdForClientCapability("http")]).toBe(1);
  });

  it("registers client capabilities correctly in ConnectionManager", async () => {
    const app = new Hono().get("/healthz", (c) => c.json({ status: "ok" }));
    const srv = await startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    // Connect a client with only the "cli" capability
    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: srv.adminToken,
      capabilities: ["cli"],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await connectedP;
    await delay(50);

    // Verify capability-based lookup works
    const cliClient = srv.connectionManager.getClientForCapability(
      descriptorIdForClientCapability("cli"),
    );
    expect(cliClient).toBeDefined();
    expect(cliClient!.capabilities).toContainEqual({
      id: descriptorIdForClientCapability("cli"),
      version: "1.0.0",
    });

    // Should NOT find a "playwright" client
    const pwClient = srv.connectionManager.getClientForCapability(
      descriptorIdForClientCapability("playwright"),
    );
    expect(pwClient).toBeUndefined();
  });

  it("destroys socket for non-/ws upgrade requests", async () => {
    const app = new Hono().get("/healthz", (c) => c.json({ status: "ok" }));
    const srv = await startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    // Attempt a WebSocket connection to a non-/ws path
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/not-ws`);

    const result = await new Promise<string>((resolve) => {
      ws.addEventListener("open", () => resolve("open"));
      ws.addEventListener("error", () => resolve("error"));
      ws.addEventListener("close", () => resolve("close"));
    });

    // The socket should be destroyed, leading to error or close
    expect(result).not.toBe("open");

    // No clients should be registered
    const stats = srv.connectionManager.getStats();
    expect(stats.totalClients).toBe(0);
  });

  it("serves HTTP requests alongside WebSocket upgrades", async () => {
    const app = new Hono().get("/healthz", (c) => c.json({ status: "ok" }));
    const srv = await startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    // Verify /healthz still works over plain HTTP
    const res = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");

    // Connect a WebSocket client alongside
    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: srv.adminToken,
      capabilities: ["http"],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await connectedP;
    await delay(50);

    // Both HTTP and WS should work
    expect(client.connected).toBe(true);
    expect(srv.connectionManager.getStats().totalClients).toBe(1);

    // HTTP still works after WS connection
    const res2 = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    expect(res2.status).toBe(200);
  });
});
