import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("open timeout")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), 5_000);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString("utf-8") });
    });
  });
}

describe("WS handler integration", () => {
  let server: Server | undefined;
  let homeDir: string | undefined;
  let clients: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    clients = [];

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
  });

  it("accepts connection, completes hello handshake, and registers client", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
      isLocalOnly: true,
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

    // Connect without token (local-only mode allows it)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.push(ws);
    await waitForOpen(ws);

    // Before hello, no clients should be registered
    expect(connectionManager.getStats().totalClients).toBe(0);

    // Send hello handshake
    ws.send(JSON.stringify({
      type: "hello",
      capabilities: ["playwright"],
    }));

    // Wait briefly for the server to process the hello
    await new Promise((resolve) => setTimeout(resolve, 100));

    // After hello, client should be registered with the right capability
    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    // Verify we can find a client for the playwright capability
    const client = connectionManager.getClientForCapability("playwright");
    expect(client).toBeDefined();

    stopHeartbeat();
  });

  it("rejects connection with invalid token in non-local mode", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
      isLocalOnly: false,
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

    // Connect with bad token
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bad-token`);
    clients.push(ws);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);

    stopHeartbeat();
  });
});
