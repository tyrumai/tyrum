import { expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { generateKeyPairSync, sign } from "node:crypto";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { createPairingRoutes } from "../../src/routes/pairing.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForCondition } from "../helpers/wait-for.js";
import type { TestContext } from "./ws-handler.test-support.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  DEFAULT_TENANT_ID,
  authProtocols,
  buildTranscript,
  completeHandshake,
  computeDeviceId,
  createAuthTokens,
  descriptorIdForClientCapability,
  waitForJsonMessage,
  waitForJsonMessageMatching,
  waitForOpen,
} from "./ws-handler.test-support.js";

function registerHttpApprovalTests(ctx: TestContext): void {
  it("emits pairing.approved to the node when approval is done via HTTP routes", async () => {
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
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    ctx.clients.push(node);
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

    const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
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
}

function registerIpResolutionTests(ctx: TestContext): void {
  it("stores resolved and raw client IPs for WS presence and pairing when proxies are trusted", async () => {
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
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      trustedProxies: "127.0.0.1",
      presenceDal: container.presenceDal,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken), {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    ctx.clients.push(node);
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
        const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
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

    const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
    const pairingMetadata = pairing?.node.metadata as Record<string, unknown> | undefined;
    expect(pairingMetadata).toMatchObject({
      ip: "203.0.113.9",
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "203.0.113.9",
    });

    stopHeartbeat();
  });

  it("ignores forwarded WS headers for presence and pairing when proxies are untrusted", async () => {
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
      protocolDeps: { connectionManager, nodePairingDal: container.nodePairingDal },
      authTokens,
      presenceDal: container.presenceDal,
      nodePairingDal: container.nodePairingDal,
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

    const node = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken), {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    ctx.clients.push(node);
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
        const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
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

    const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
    const pairingMetadata = pairing?.node.metadata as Record<string, unknown> | undefined;
    expect(pairingMetadata).toMatchObject({
      ip: "127.0.0.1",
      raw_remote_ip: "127.0.0.1",
      resolved_client_ip: "127.0.0.1",
    });

    stopHeartbeat();
  });
}

export function registerWsHandlerPairingHttpTests(ctx: TestContext): void {
  registerHttpApprovalTests(ctx);
  registerIpResolutionTests(ctx);
}
