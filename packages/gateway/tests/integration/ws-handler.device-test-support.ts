import { expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { generateKeyPairSync, sign } from "node:crypto";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "./ws-handler.test-support.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  authProtocols,
  buildTranscript,
  computeDeviceId,
  createAuthTokens,
  descriptorIdForClientCapability,
  issueDeviceToken,
  waitForClose,
  waitForJsonMessage,
  waitForMessageOrClose,
  waitForOpen,
} from "./ws-handler.test-support.js";

const httpDescriptor = {
  id: descriptorIdForClientCapability("http"),
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
} as const;

function registerDeviceProofTests(ctx: TestContext): void {
  it("supports connect.init/connect.proof with device identity proof", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const {
      container,
      authTokens,
      tenantAdminToken: adminToken,
    } = await createAuthTokens(ctx.homeDir!);
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
          capabilities: [httpDescriptor],
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
    expect(registered!.capabilities).toEqual([httpDescriptor]);

    stopHeartbeat();
  });

  it("rejects connect.init when protocol_rev is unsupported", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const {
      container,
      authTokens,
      tenantAdminToken: adminToken,
    } = await createAuthTokens(ctx.homeDir!);
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
          capabilities: [httpDescriptor],
        },
      }),
    );

    const close = await waitForClose(ws);
    expect(close.code).toBe(4005);
    expect(close.reason).toBe("protocol_rev mismatch");
    expect(connectionManager.getStats().totalClients).toBe(0);
    stopHeartbeat();
  });
}

function registerDeviceTokenTests(ctx: TestContext): void {
  it("rejects legacy connect handshake when using a device token", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(token));
    ctx.clients.push(ws);
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
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(tokenA));
    ctx.clients.push(ws);
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
          capabilities: [httpDescriptor],
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
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens } = await createAuthTokens(ctx.homeDir!);
    ctx.containers.push(container);

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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(token));
    ctx.clients.push(ws);
    await waitForOpen(ws);

    ws.send(
      JSON.stringify({
        request_id: "r-init",
        type: "connect.init",
        payload: {
          protocol_rev: 2,
          role: "node",
          device: { device_id: deviceId, pubkey: pubkeyB64Url, label: "test" },
          capabilities: [httpDescriptor],
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
}

export function registerWsHandlerDeviceTests(ctx: TestContext): void {
  registerDeviceProofTests(ctx);
  registerDeviceTokenTests(ctx);
}
