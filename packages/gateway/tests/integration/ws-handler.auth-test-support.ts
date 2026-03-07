import { expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "./ws-handler.test-support.js";
import {
  AUTH_COOKIE_NAME,
  authProtocols,
  completeHandshake,
  createAuthTokens,
  waitForClose,
  waitForOpen,
  waitForUnexpectedResponse,
} from "./ws-handler.test-support.js";

export function registerWsHandlerAuthTests(ctx: TestContext): void {
  it("accepts connection, completes connect.init/connect.proof handshake, and registers client", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    ctx.clients.push(ws);
    await waitForOpen(ws);

    // Before connect, no clients should be registered
    expect(connectionManager.getStats().totalClients).toBe(0);

    await completeHandshake(ws, {
      requestIdPrefix: "r",
      role: "client",
      capabilities: ["playwright"],
    });

    // After connect, client should be registered with the right capability
    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    // Verify we can find a client for the playwright capability
    const client = connectionManager.getClientForCapability("playwright");
    expect(client).toBeDefined();

    stopHeartbeat();
  });

  it("rejects legacy connect handshake requests", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    ctx.clients.push(ws);
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        request_id: "r-1",
        type: "connect",
        payload: { capabilities: ["playwright"] },
      }),
    );

    const { code, reason } = await waitForClose(ws, 2_000);
    expect(code).toBe(4003);
    expect(reason).toBe("legacy connect is deprecated; use connect.init/connect.proof");
    expect(connectionManager.getStats().totalClients).toBe(0);

    stopHeartbeat();
  });

  it("accepts connection authenticated via Authorization header during upgrade", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    ctx.clients.push(ws);
    await waitForOpen(ws);

    expect(connectionManager.getStats().totalClients).toBe(0);

    await completeHandshake(ws, {
      requestIdPrefix: "r",
      role: "client",
      capabilities: ["playwright"],
    });

    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    stopHeartbeat();
  });

  it("rejects upgrades that omit the tyrum-v1 base subprotocol", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["custom-protocol"], {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const response = await waitForUnexpectedResponse(ws, 2_000);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("tyrum-v1");
    expect(connectionManager.getStats().totalClients).toBe(0);

    stopHeartbeat();
  });

  it("accepts connection authenticated via cookie during upgrade", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    ctx.clients.push(ws);
    await waitForOpen(ws);

    expect(connectionManager.getStats().totalClients).toBe(0);

    await completeHandshake(ws, {
      requestIdPrefix: "r",
      role: "client",
      capabilities: ["playwright"],
    });

    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    stopHeartbeat();
  });

  it("accepts cookie-authenticated upgrade when token contains '=' characters", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}; other=tyrum-test-token==with=equals==`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    ctx.clients.push(ws);
    await waitForOpen(ws);

    await completeHandshake(ws, {
      requestIdPrefix: "r",
      role: "client",
      capabilities: ["playwright"],
    });

    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    stopHeartbeat();
  });

  it("rejects cookie-authenticated upgrade without Origin header", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
    });
    ctx.clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects cookie-authenticated upgrade when Origin does not match Host", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: "http://evil.example",
      },
    });
    ctx.clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects cookie-authenticated upgrade when Origin port does not match default Host port", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: "http://127.0.0.1:9999",
        Host: "127.0.0.1",
      },
    });
    ctx.clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects connection with invalid token", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
    });

    ctx.setServer(createServer());
    ctx.server!.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      ctx.server!.listen(0, "127.0.0.1", () => {
        const addr = ctx.server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // Connect with bad token
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols("bad-token"));
    ctx.clients.push(ws);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);

    stopHeartbeat();
  });
}
