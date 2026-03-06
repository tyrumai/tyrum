import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { AUTH_COOKIE_NAME } from "../../src/modules/auth/http.js";
import { createTestContainer } from "./helpers.js";
import { createPairingRoutes } from "../../src/routes/pairing.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { buildTranscript, completeHandshake, computeDeviceId } from "./ws-handshake.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { waitForCondition } from "../helpers/wait-for.js";

function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

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

function waitForClose(ws: WebSocket, timeoutMs = 5_000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString("utf-8") });
    });
  });
}

function waitForJsonMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 5_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString("utf-8")) as Record<string, unknown>);
    });
  });
}

function waitForMessageOrClose(
  ws: WebSocket,
  timeoutMs = 5_000,
): Promise<
  | { kind: "close"; code: number; reason: string }
  | { kind: "message"; msg: Record<string, unknown> }
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    };

    const onMessage = (data: unknown) => {
      cleanup();
      try {
        resolve({ kind: "message", msg: JSON.parse(String(data)) as Record<string, unknown> });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      resolve({ kind: "close", code, reason: reason.toString("utf-8") });
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.on("error", onError);
  });
}

function waitForJsonMessageMatching(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
  label = "unknown",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`message timeout (${label})`));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (!predicate(msg)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.on("message", onMessage);
  });
}

function recordJsonMessages(ws: WebSocket): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)) as Record<string, unknown>);
    } catch {
      // ignore malformed frames
    }
  });
  return messages;
}

async function createAuthTokens(tyrumHome: string): Promise<{
  container: GatewayContainer;
  authTokens: AuthTokenService;
  tenantAdminToken: string;
}> {
  const container = await createTestContainer({ tyrumHome });
  const authTokens = new AuthTokenService(container.db);
  const issued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: "admin",
    scopes: ["*"],
  });
  return { container, authTokens, tenantAdminToken: issued.token };
}

async function issueDeviceToken(
  authTokens: AuthTokenService,
  input: {
    deviceId: string;
    role: "client" | "node";
    scopes: string[];
    ttlSeconds: number;
  },
): Promise<string> {
  const issued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: input.role,
    scopes: input.scopes,
    deviceId: input.deviceId,
    ttlSeconds: input.ttlSeconds,
  });
  return issued.token;
}

describe("WS handler integration", () => {
  let server: Server | undefined;
  let homeDir: string | undefined;
  let clients: WebSocket[] = [];
  let containers: GatewayContainer[] = [];

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

    for (const container of containers) {
      await container.db.close();
    }
    containers = [];

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("accepts connection, completes connect.init/connect.proof handshake, and registers client", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(ws);
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
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(ws);
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
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    clients.push(ws);
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

  it("accepts connection authenticated via cookie during upgrade", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    clients.push(ws);
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
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}; other=tyrum-test-token==with=equals==`,
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    clients.push(ws);
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
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
    });
    clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects cookie-authenticated upgrade when Origin does not match Host", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: "http://evil.example",
      },
    });
    clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects cookie-authenticated upgrade when Origin port does not match default Host port", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tyrum-v1"], {
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
        Origin: "http://127.0.0.1:9999",
        Host: "127.0.0.1",
      },
    });
    clients.push(ws);

    const { code } = await waitForClose(ws, 2_000);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("rejects connection with invalid token", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols("bad-token"));
    clients.push(ws);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("supports connect.init/connect.proof with device identity proof", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(ws);
    await waitForOpen(ws);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);

    ws.send(
      JSON.stringify({
        request_id: "r-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "client",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "test" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("http"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const initRes = await waitForJsonMessage(ws);
    expect(initRes["type"]).toBe("connect.init");
    expect(initRes["request_id"]).toBe("r-init");
    expect(initRes["ok"]).toBe(true);

    const initResult = initRes["result"] as Record<string, unknown>;
    const connectionId = String(initResult["connection_id"]);
    const challenge = String(initResult["challenge"]);

    const transcript = buildTranscript({
      protocolRev: 2,
      role: "client",
      deviceId,
      connectionId,
      challenge,
    });
    const signature = sign(null, transcript, privateKey);
    const proof = signature.toString("base64url");

    ws.send(
      JSON.stringify({
        request_id: "r-proof",
        type: "connect.proof",
        payload: { connection_id: connectionId, proof },
      }),
    );

    const proofRes = await waitForJsonMessage(ws);
    expect(proofRes["type"]).toBe("connect.proof");
    expect(proofRes["request_id"]).toBe("r-proof");
    expect(proofRes["ok"]).toBe(true);

    const proofResult = proofRes["result"] as Record<string, unknown>;
    const clientId = String(proofResult["client_id"]);
    expect(clientId).toBe(connectionId);

    const registered = connectionManager.getClient(clientId);
    expect(registered).toBeDefined();
    expect(registered!.device_id).toBe(deviceId);
    expect(registered!.role).toBe("client");
    expect(registered!.capabilities).toEqual(["http"]);

    stopHeartbeat();
  });

  it("rejects connect.init when protocol_rev is unsupported", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(ws);
    await waitForOpen(ws);

    const { publicKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);

    ws.send(
      JSON.stringify({
        request_id: "r-init",
        type: "connect.init",
        payload: {
          protocol_rev: 999,
          role: "client",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "test" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("http"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const close = await waitForClose(ws);
    expect(close.code).toBe(4005);
    expect(close.reason).toBe("protocol_rev mismatch");
    expect(connectionManager.getStats().totalClients).toBe(0);
    stopHeartbeat();
  });

  it("rejects legacy connect handshake when using a device token", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens } = await createAuthTokens(homeDir);
    containers.push(container);
    const token = await issueDeviceToken(authTokens, {
      deviceId: "dev_client_legacy",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(token));
    clients.push(ws);
    await waitForOpen(ws);

    const firstPromise = waitForMessageOrClose(ws);
    ws.send(
      JSON.stringify({
        request_id: "r-connect",
        type: "connect",
        payload: { capabilities: [] },
      }),
    );

    const first = await firstPromise;
    expect(first.kind).toBe("close");
    if (first.kind === "close") {
      expect(first.code).toBe(4003);
      expect(first.reason).toBe("legacy connect is deprecated; use connect.init/connect.proof");
    }

    expect(connectionManager.getStats().totalClients).toBe(0);

    stopHeartbeat();
  });

  it("rejects connect.init when device token device_id does not match the proved device identity", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens } = await createAuthTokens(homeDir);
    containers.push(container);

    const { publicKey: publicKeyA } = generateKeyPairSync("ed25519");
    const pubkeyDerA = publicKeyA.export({ format: "der", type: "spki" }) as Buffer;
    const deviceIdA = computeDeviceId(pubkeyDerA);
    const tokenA = await issueDeviceToken(authTokens, {
      deviceId: deviceIdA,
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(tokenA));
    clients.push(ws);
    await waitForOpen(ws);

    const { publicKey: publicKeyB } = generateKeyPairSync("ed25519");
    const pubkeyDerB = publicKeyB.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64UrlB = pubkeyDerB.toString("base64url");
    const deviceIdB = computeDeviceId(pubkeyDerB);

    ws.send(
      JSON.stringify({
        request_id: "r-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "client",
          device: { device_id: deviceIdB, pubkey: pubkeyB64UrlB, label: "test" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("http"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const first = await waitForMessageOrClose(ws);
    expect(first.kind).toBe("close");
    if (first.kind === "close") {
      expect(first.code).toBe(4001);
    } else {
      expect(first.msg).toMatchObject({ type: "connect.init", ok: false });
    }

    stopHeartbeat();
  });

  it("rejects connect.init when device token role does not match the declared WS role", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens } = await createAuthTokens(homeDir);
    containers.push(container);

    const { publicKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);
    const token = await issueDeviceToken(authTokens, {
      deviceId,
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(token));
    clients.push(ws);
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        request_id: "r-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "test" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("http"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const first = await waitForMessageOrClose(ws);
    expect(first.kind).toBe("close");
    if (first.kind === "close") {
      expect(first.code).toBe(4001);
    } else {
      expect(first.msg).toMatchObject({ type: "connect.init", ok: false });
    }

    stopHeartbeat();
  });

  it("creates a pairing request when a node connects and allows WS approval", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      nodePairingDal: container.nodePairingDal,
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

    const operator = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(operator);
    await waitForOpen(operator);
    await completeHandshake(operator, { requestIdPrefix: "op", role: "client", capabilities: [] });

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(node);
    await waitForOpen(node);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);

    node.send(
      JSON.stringify({
        request_id: "r-node-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "node-1" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const initRes = await waitForJsonMessage(node);
    const initResult = initRes["result"] as Record<string, unknown>;
    const connectionId = String(initResult["connection_id"]);
    const challenge = String(initResult["challenge"]);

    const transcript = buildTranscript({
      protocolRev: 2,
      role: "node",
      deviceId,
      connectionId,
      challenge,
    });
    const signature = sign(null, transcript, privateKey);
    const proof = signature.toString("base64url");

    node.send(
      JSON.stringify({
        request_id: "r-node-proof",
        type: "connect.proof",
        payload: { connection_id: connectionId, proof },
      }),
    );
    await waitForJsonMessageMatching(
      node,
      (msg) => msg["type"] === "connect.proof" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "node.connect.proof",
    );

    const pairingEvt = await waitForJsonMessageMatching(
      operator,
      (msg) =>
        msg["type"] === "pairing.requested" &&
        Object.prototype.hasOwnProperty.call(msg, "event_id"),
      5_000,
      "pairing.requested",
    );
    expect(pairingEvt["type"]).toBe("pairing.requested");

    const pairing = await container.nodePairingDal.getByNodeId(deviceId);
    expect(pairing).toBeDefined();
    expect(pairing!.status).toBe("pending");

    const operatorMessages = recordJsonMessages(operator);
    const nodeMessages = recordJsonMessages(node);

    operator.send(
      JSON.stringify({
        request_id: "r-approve",
        type: "pairing.approve",
        payload: {
          pairing_id: pairing!.pairing_id,
          reason: "ok",
          trust_level: "remote",
          capability_allowlist: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );
    const approveRes = await waitForJsonMessageMatching(
      operator,
      (msg) => msg["type"] === "pairing.approve" && Object.prototype.hasOwnProperty.call(msg, "ok"),
    );
    expect(approveRes["ok"]).toBe(true);

    const pairing2 = await container.nodePairingDal.getById(pairing!.pairing_id);
    expect(pairing2).toBeDefined();
    expect(pairing2!.status).toBe("approved");
    expect((pairing2 as any)["trust_level"]).toBe("remote");
    expect((pairing2 as any)["capability_allowlist"]).toEqual([
      {
        id: descriptorIdForClientCapability("cli"),
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
    ]);
    await waitForCondition(
      () => operatorMessages.some((msg) => msg["type"] === "pairing.resolved"),
      { description: "operator pairing.resolved event" },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(nodeMessages.some((msg) => msg["type"] === "pairing.resolved")).toBe(false);

    stopHeartbeat();
  });

  it("issues a node-scoped token on approval and invalidates it on revocation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      nodePairingDal: container.nodePairingDal,
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

    const operator = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(operator);
    await waitForOpen(operator);
    await completeHandshake(operator, { requestIdPrefix: "op", role: "client", capabilities: [] });

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(node);
    await waitForOpen(node);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);

    node.send(
      JSON.stringify({
        request_id: "r-node-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "node-1" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const initRes = await waitForJsonMessage(node);
    const initResult = initRes["result"] as Record<string, unknown>;
    const connectionId = String(initResult["connection_id"]);
    const challenge = String(initResult["challenge"]);

    const transcript = buildTranscript({
      protocolRev: 2,
      role: "node",
      deviceId,
      connectionId,
      challenge,
    });
    const signature = sign(null, transcript, privateKey);
    const proof = signature.toString("base64url");

    node.send(
      JSON.stringify({
        request_id: "r-node-proof",
        type: "connect.proof",
        payload: { connection_id: connectionId, proof },
      }),
    );
    await waitForJsonMessageMatching(
      node,
      (msg) => msg["type"] === "connect.proof" && Object.prototype.hasOwnProperty.call(msg, "ok"),
    );

    const pairingEvt = await waitForJsonMessageMatching(
      operator,
      (msg) =>
        msg["type"] === "pairing.requested" &&
        Object.prototype.hasOwnProperty.call(msg, "event_id"),
    );
    const pairingPayload = pairingEvt["payload"] as Record<string, unknown>;
    const pairing = pairingPayload["pairing"] as Record<string, unknown>;
    const pairingId = Number(pairing["pairing_id"]);
    expect(pairingId).toBeGreaterThan(0);

    const approvedEvtP = waitForJsonMessageMatching(
      node,
      (msg) =>
        msg["type"] === "pairing.approved" && Object.prototype.hasOwnProperty.call(msg, "event_id"),
      5_000,
      "pairing.approved",
    );

    operator.send(
      JSON.stringify({
        request_id: "r-approve",
        type: "pairing.approve",
        payload: {
          pairing_id: pairingId,
          reason: "ok",
          trust_level: "remote",
          capability_allowlist: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );
    const approveRes = await waitForJsonMessageMatching(
      operator,
      (msg) => msg["type"] === "pairing.approve" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "pairing.approve.response",
    );
    expect(approveRes["ok"]).toBe(true);

    const approvedEvt = await approvedEvtP;
    const approvedPayload = approvedEvt["payload"] as Record<string, unknown>;
    const scopedToken = String(approvedPayload["scoped_token"] ?? "");
    expect(scopedToken.length).toBeGreaterThan(0);

    node.close();
    await waitForClose(node);

    // Regression: the node-scoped token lookup can be async (e.g. Postgres),
    // so make sure we don't drop connect.init frames that arrive while auth is resolving.
    const originalTokenLookup = container.nodePairingDal.getNodeIdForScopedToken.bind(
      container.nodePairingDal,
    );
    container.nodePairingDal.getNodeIdForScopedToken = async (token: string) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      return await originalTokenLookup(token);
    };

    const node2 = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(scopedToken));
    clients.push(node2);
    await waitForOpen(node2);

    node2.send(
      JSON.stringify({
        request_id: "r-node2-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "node-1" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const init2Res = await waitForJsonMessage(node2);
    const init2Result = init2Res["result"] as Record<string, unknown>;
    const connectionId2 = String(init2Result["connection_id"]);
    const challenge2 = String(init2Result["challenge"]);
    const transcript2 = buildTranscript({
      protocolRev: 2,
      role: "node",
      deviceId,
      connectionId: connectionId2,
      challenge: challenge2,
    });
    const signature2 = sign(null, transcript2, privateKey);
    const proof2 = signature2.toString("base64url");

    node2.send(
      JSON.stringify({
        request_id: "r-node2-proof",
        type: "connect.proof",
        payload: { connection_id: connectionId2, proof: proof2 },
      }),
    );
    await waitForJsonMessageMatching(
      node2,
      (msg) => msg["type"] === "connect.proof" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "node2.connect.proof",
    );

    operator.send(
      JSON.stringify({
        request_id: "r-revoke",
        type: "pairing.revoke",
        payload: { pairing_id: pairingId, reason: "revoked" },
      }),
    );
    const revokeRes = await waitForJsonMessageMatching(
      operator,
      (msg) => msg["type"] === "pairing.revoke" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "pairing.revoke.response",
    );
    expect(revokeRes["ok"]).toBe(true);

    node2.close();
    await waitForClose(node2);

    const node3 = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(scopedToken));
    clients.push(node3);
    await waitForOpen(node3);
    const close3 = await waitForClose(node3);
    expect(close3.code).toBe(4001);

    stopHeartbeat();
  }, 15_000);

  it("emits pairing.approved to the node when approval is done via HTTP routes", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    clients.push(node);
    await waitForOpen(node);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pubkeyB64Url = pubkeyDer.toString("base64url");
    const deviceId = computeDeviceId(pubkeyDer);

    node.send(
      JSON.stringify({
        request_id: "r-node-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "node-1" },
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
    );

    const initRes = await waitForJsonMessage(node);
    const initResult = initRes["result"] as Record<string, unknown>;
    const connectionId = String(initResult["connection_id"]);
    const challenge = String(initResult["challenge"]);

    const transcript = buildTranscript({
      protocolRev: 2,
      role: "node",
      deviceId,
      connectionId,
      challenge,
    });
    const signature = sign(null, transcript, privateKey);
    const proof = signature.toString("base64url");

    node.send(
      JSON.stringify({
        request_id: "r-node-proof",
        type: "connect.proof",
        payload: { connection_id: connectionId, proof },
      }),
    );
    await waitForJsonMessageMatching(
      node,
      (msg) => msg["type"] === "connect.proof" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "node.connect.proof",
    );

    const pairing = await container.nodePairingDal.getByNodeId(deviceId);
    expect(pairing).toBeDefined();
    expect(pairing!.status).toBe("pending");

    const approvedEvtP = waitForJsonMessageMatching(
      node,
      (msg) =>
        msg["type"] === "pairing.approved" && Object.prototype.hasOwnProperty.call(msg, "event_id"),
      5_000,
      "pairing.approved",
    );

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route(
      "/",
      createPairingRoutes({ nodePairingDal: container.nodePairingDal, ws: { connectionManager } }),
    );

    const res = await app.request(`/pairings/${String(pairing!.pairing_id)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const approvedEvt = await approvedEvtP;
    const approvedPayload = approvedEvt["payload"] as Record<string, unknown>;
    const scopedToken = String(approvedPayload["scoped_token"] ?? "");
    expect(scopedToken.length).toBeGreaterThan(0);

    stopHeartbeat();
  }, 15_000);

  it("stores resolved and raw client IPs for WS presence and pairing when proxies are trusted", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      trustedProxies: "127.0.0.1",
      presenceDal: container.presenceDal,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken), {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    clients.push(node);
    await waitForOpen(node);

    const { deviceId } = await completeHandshake(node, {
      requestIdPrefix: "node",
      role: "node",
      capabilities: ["cli"],
      label: "node-1",
    });

    await waitForCondition(
      async () => {
        const presence = await container.presenceDal.getByInstanceId(deviceId);
        const pairing = await container.nodePairingDal.getByNodeId(deviceId);
        return Boolean(presence && pairing);
      },
      { description: "ws presence and pairing records" },
    );

    const presence = await container.presenceDal.getByInstanceId(deviceId);
    expect(presence?.ip).toBe("203.0.113.9");
    expect(presence?.metadata).toMatchObject({
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "203.0.113.9",
    });

    const pairing = await container.nodePairingDal.getByNodeId(deviceId);
    const pairingMetadata = pairing?.node.metadata as Record<string, unknown> | undefined;
    expect(pairingMetadata).toMatchObject({
      ip: "203.0.113.9",
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "203.0.113.9",
    });

    stopHeartbeat();
  });

  it("ignores forwarded WS headers for presence and pairing when proxies are untrusted", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(homeDir);
    containers.push(container);

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      presenceDal: container.presenceDal,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken), {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    clients.push(node);
    await waitForOpen(node);

    const { deviceId } = await completeHandshake(node, {
      requestIdPrefix: "node",
      role: "node",
      capabilities: ["cli"],
      label: "node-1",
    });

    await waitForCondition(
      async () => {
        const presence = await container.presenceDal.getByInstanceId(deviceId);
        const pairing = await container.nodePairingDal.getByNodeId(deviceId);
        return Boolean(presence && pairing);
      },
      { description: "ws presence and pairing records" },
    );

    const presence = await container.presenceDal.getByInstanceId(deviceId);
    expect(presence?.ip).toBe("127.0.0.1");
    expect(presence?.metadata).toMatchObject({
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "127.0.0.1",
    });

    const pairing = await container.nodePairingDal.getByNodeId(deviceId);
    const pairingMetadata = pairing?.node.metadata as Record<string, unknown> | undefined;
    expect(pairingMetadata).toMatchObject({
      ip: "127.0.0.1",
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "127.0.0.1",
    });

    stopHeartbeat();
  });
});
