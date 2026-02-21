import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createTestContainer } from "./helpers.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

function authProtocols(token: string): string[] {
  return [
    "tyrum-v1",
    `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`,
  ];
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

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), 5_000);
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

function waitForJsonMessageMatching(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("message timeout"));
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

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
function base32LowerNoPad(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return `dev_${base32LowerNoPad(digest)}`;
}

function buildTranscript(input: {
  protocolRev: number;
  role: "client" | "node";
  deviceId: string;
  connectionId: string;
  challenge: string;
}): Buffer {
  const text =
    `tyrum-connect-proof\n` +
    `protocol_rev=${String(input.protocolRev)}\n` +
    `role=${input.role}\n` +
    `device_id=${input.deviceId}\n` +
    `connection_id=${input.connectionId}\n` +
    `challenge=${input.challenge}\n`;
  return Buffer.from(text, "utf-8");
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

  it("accepts connection, completes connect handshake, and registers client", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    const adminToken = await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
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

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      authProtocols(adminToken),
    );
    clients.push(ws);
    await waitForOpen(ws);

    // Before connect, no clients should be registered
    expect(connectionManager.getStats().totalClients).toBe(0);

    // Send connect handshake
    ws.send(
      JSON.stringify({
        request_id: "r-1",
        type: "connect",
        payload: { capabilities: ["playwright"] },
      }),
    );

    // Wait briefly for the server to process the connect
    await new Promise((resolve) => setTimeout(resolve, 100));

    // After connect, client should be registered with the right capability
    const stats = connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["playwright"]).toBe(1);

    // Verify we can find a client for the playwright capability
    const client = connectionManager.getClientForCapability("playwright");
    expect(client).toBeDefined();

    stopHeartbeat();
  });

  it("rejects connection with invalid token", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
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
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      authProtocols("bad-token"),
    );
    clients.push(ws);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);

    stopHeartbeat();
  });

  it("supports connect.init/connect.proof with device identity proof", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    const adminToken = await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
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
          capabilities: [{ id: "http" }],
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

  it("creates a pairing request when a node connects and allows WS approval", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ws-"));
    const tokenStore = new TokenStore(homeDir);
    const adminToken = await tokenStore.initialize();
    const container = await createTestContainer();

    const connectionManager = new ConnectionManager();
    const { handleUpgrade, stopHeartbeat } = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      tokenStore,
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
    operator.send(
      JSON.stringify({
        request_id: "r-op-connect",
        type: "connect",
        payload: { capabilities: [] },
      }),
    );
    await waitForJsonMessageMatching(
      operator,
      (msg) => msg["type"] === "connect" && Object.prototype.hasOwnProperty.call(msg, "ok"),
    );

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
          capabilities: [{ id: "cli" }],
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
      (msg) => msg["type"] === "pairing.requested" && Object.prototype.hasOwnProperty.call(msg, "event_id"),
    );
    expect(pairingEvt["type"]).toBe("pairing.requested");

    const pairing = await container.nodePairingDal.getByNodeId(deviceId);
    expect(pairing).toBeDefined();
    expect(pairing!.status).toBe("pending");

    operator.send(
      JSON.stringify({
        request_id: "r-approve",
        type: "pairing.approve",
        payload: { pairing_id: pairing!.pairing_id, reason: "ok" },
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

    stopHeartbeat();
  });
});
