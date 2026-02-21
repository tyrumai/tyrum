import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WS handler integration", () => {
  let server: Server | undefined;
  let db: SqliteDb | undefined;
  let homeDir: string | undefined;

  beforeEach(() => {
    // Ensure other test files don't leak fake timers into this integration suite.
    vi.useRealTimers();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = undefined;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }

    await db?.close();
    db = undefined;
  });

  it("accepts connection, completes connect handshake, and registers client", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    const adminToken = await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
      db,
    });

    server = createServer();
    server.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // Before connect, no clients should be registered
    expect(connectionManager.getStats().totalClients).toBe(0);

    const client = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: adminToken,
      capabilities: ["playwright"],
      reconnect: false,
      tyrumHome: homeDir,
    });
    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });
    client.connect();
    await connectedP;

    // After connect, client should be registered with the right capability
    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    // Verify we can find a client for the playwright capability
    const connectedClient = connectionManager.getClientForCapability("playwright");
    expect(connectedClient).toBeDefined();

    client.disconnect();
    stopHeartbeat();
  });

  it("rejects connection with invalid token", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
      db,
    });

    server = createServer();
    server.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const client = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: "bad-token",
      capabilities: [],
      reconnect: false,
      tyrumHome: homeDir,
    });

    const disconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on("disconnected", resolve);
    });

    client.connect();
    const { code } = await disconnectedP;
    expect(code).toBe(4001);

    stopHeartbeat();
  });
});
