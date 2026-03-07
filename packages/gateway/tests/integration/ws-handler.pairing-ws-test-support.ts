import { expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { generateKeyPairSync, sign } from "node:crypto";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForCondition } from "../helpers/wait-for.js";
import type { TestContext } from "./ws-handler.test-support.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  authProtocols,
  buildTranscript,
  completeHandshake,
  computeDeviceId,
  createAuthTokens,
  createHandshakeIdentity,
  descriptorIdForClientCapability,
  issueDeviceToken,
  recordJsonMessages,
  waitForClose,
  waitForJsonMessage,
  waitForJsonMessageMatching,
  waitForOpen,
} from "./ws-handler.test-support.js";

export function registerWsHandlerPairingWsTests(ctx: TestContext): void {
  it("creates a pairing request when a node connects and allows WS approval", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
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

    const operatorIdentity = createHandshakeIdentity();
    const observerIdentity = createHandshakeIdentity();
    const operatorToken = await issueDeviceToken(authTokens, {
      deviceId: operatorIdentity.deviceId,
      role: "client",
      scopes: ["operator.pairing"],
      ttlSeconds: 300,
    });
    const observerToken = await issueDeviceToken(authTokens, {
      deviceId: observerIdentity.deviceId,
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const operator = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(operatorToken));
    ctx.clients.push(operator);
    await waitForOpen(operator);
    await completeHandshake(operator, {
      requestIdPrefix: "op",
      role: "client",
      capabilities: [],
      identity: operatorIdentity,
    });

    const observer = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(observerToken));
    ctx.clients.push(observer);
    await waitForOpen(observer);
    await completeHandshake(observer, {
      requestIdPrefix: "observer",
      role: "client",
      capabilities: [],
      identity: observerIdentity,
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

    const pairingEvt = await waitForJsonMessageMatching(
      operator,
      (msg) =>
        msg["type"] === "pairing.requested" &&
        Object.prototype.hasOwnProperty.call(msg, "event_id"),
      5_000,
      "pairing.requested",
    );
    expect(pairingEvt["type"]).toBe("pairing.requested");

    const pairing = await container.nodePairingDal.getByNodeId(deviceId, DEFAULT_TENANT_ID);
    expect(pairing).toBeDefined();
    expect(pairing!.status).toBe("pending");
    const operatorMessages = recordJsonMessages(operator);
    const observerMessages = recordJsonMessages(observer);
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
    const pairing2 = await container.nodePairingDal.getById(pairing!.pairing_id, DEFAULT_TENANT_ID);
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
    expect(observerMessages.some((msg) => msg["type"] === "pairing.resolved")).toBe(false);
    expect(nodeMessages.some((msg) => msg["type"] === "pairing.resolved")).toBe(false);

    stopHeartbeat();
  });

  it("issues a node-scoped token on approval and invalidates it on revocation", async () => {
    ctx.setHomeDir(await mkdtemp(join(tmpdir(), "tyrum-ws-")));
    const { container, authTokens, tenantAdminToken: adminToken } = await createAuthTokens(ctx.homeDir!);
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

    const operator = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    ctx.clients.push(operator);
    await waitForOpen(operator);
    await completeHandshake(operator, { requestIdPrefix: "op", role: "client", capabilities: [] });

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
    ctx.clients.push(node2);
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
    ctx.clients.push(node3);
    await waitForOpen(node3);
    const close3 = await waitForClose(node3);
    expect(close3.code).toBe(4001);

    stopHeartbeat();
  }, 15_000);
}
