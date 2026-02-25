import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  WsConnectInitRequest,
  WsConnectInitResponseEnvelope,
  WsConnectProofRequest,
  WsConnectProofResponseEnvelope,
  WsTaskExecuteRequest,
  WsTaskExecuteResponseEnvelope,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { dispatchTask } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TyrumClient } from "../../../client/src/ws-client.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function captureJson(into: unknown[], data: unknown): void {
  const raw =
    typeof data === "string" ? data : data instanceof Buffer ? data.toString("utf-8") : undefined;
  if (!raw) return;
  try {
    into.push(JSON.parse(raw));
  } catch {
    // ignore malformed frames
  }
}

function isRequestOfType(msg: unknown, type: string): boolean {
  return (
    isRecord(msg) &&
    msg["type"] === type &&
    typeof msg["request_id"] === "string" &&
    Object.prototype.hasOwnProperty.call(msg, "payload") &&
    !Object.prototype.hasOwnProperty.call(msg, "ok") &&
    !Object.prototype.hasOwnProperty.call(msg, "event_id")
  );
}

function isResponseOfType(msg: unknown, type: string): boolean {
  return (
    isRecord(msg) &&
    msg["type"] === type &&
    typeof msg["request_id"] === "string" &&
    Object.prototype.hasOwnProperty.call(msg, "ok") &&
    !Object.prototype.hasOwnProperty.call(msg, "event_id")
  );
}

function mustFind(
  messages: unknown[],
  predicate: (msg: unknown) => boolean,
  label: string,
): unknown {
  const found = messages.find(predicate);
  expect(found, label).toBeDefined();
  return found!;
}

async function startInstrumentedGateway(
  depsFactory: (connectionManager: ConnectionManager) => ProtocolDeps,
): Promise<{
  port: number;
  adminToken: string;
  stop: () => Promise<void>;
  clientToGateway: unknown[];
  gatewayToClient: unknown[];
  protocolDeps: ProtocolDeps;
}> {
  const connectionManager = new ConnectionManager();
  const protocolDeps = depsFactory(connectionManager);

  const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-contract-"));
  const tokenStore = new TokenStore(tokenHome);
  const adminToken = await tokenStore.initialize();

  const { wss, handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
  });

  const clientToGateway: unknown[] = [];
  const gatewayToClient: unknown[] = [];

  wss.on("connection", (ws) => {
    const originalSend = ws.send.bind(ws);
    ws.send = ((data: unknown, ...args: unknown[]) => {
      captureJson(gatewayToClient, data);
      return originalSend(data as never, ...(args as never[]));
    }) as typeof ws.send;

    ws.on("message", (data) => {
      captureJson(clientToGateway, data);
    });
  });

  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(req, socket, head);
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });

  async function stop(): Promise<void> {
    stopHeartbeat();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tokenHome, { recursive: true, force: true });
  }

  return { port, adminToken, stop, clientToGateway, gatewayToClient, protocolDeps };
}

describe("WS contract conformance (gateway <-> client <-> schemas)", () => {
  let server: Awaited<ReturnType<typeof startInstrumentedGateway>> | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  it("vNext handshake + task.execute exchange conform to @tyrum/schemas contracts", async () => {
    let resolveTaskResult:
      | ((value: { taskId: string; success: boolean; evidence: unknown; error?: string }) => void)
      | undefined;
    const taskResultP = new Promise<{
      taskId: string;
      success: boolean;
      evidence: unknown;
      error?: string;
    }>((resolve) => {
      resolveTaskResult = resolve;
    });

    server = await startInstrumentedGateway((connectionManager) => {
      return {
        connectionManager,
        onTaskResult(taskId, success, evidence, error) {
          resolveTaskResult?.({ taskId, success, evidence, error });
        },
      };
    });

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

    client = new TyrumClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: server.adminToken,
      capabilities: ["http"],
      reconnect: false,
      useDeviceProof: true,
      role: "client",
      protocolRev: 2,
      device: {
        publicKey: publicKeyDer.toString("base64url"),
        privateKey: privateKeyDer.toString("base64url"),
      },
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    const taskExecuteP = new Promise<unknown>((resolve) => {
      client!.on("task_execute", resolve);
    });

    client.connect();
    await withTimeout(connectedP, 5_000, "connected");

    // Let handshake frames flush through the node event loop.
    await delay(25);

    const initReq = mustFind(
      server.clientToGateway,
      (m) => isRequestOfType(m, "connect.init"),
      "connect.init request",
    );
    const initRes = mustFind(
      server.gatewayToClient,
      (m) => isResponseOfType(m, "connect.init"),
      "connect.init response",
    );
    const proofReq = mustFind(
      server.clientToGateway,
      (m) => isRequestOfType(m, "connect.proof"),
      "connect.proof request",
    );
    const proofRes = mustFind(
      server.gatewayToClient,
      (m) => isResponseOfType(m, "connect.proof"),
      "connect.proof response",
    );

    WsConnectInitRequest.parse(initReq);
    WsConnectInitResponseEnvelope.parse(initRes);
    WsConnectProofRequest.parse(proofReq);
    WsConnectProofResponseEnvelope.parse(proofRes);

    const taskId = await dispatchTask(
      { type: "Http", args: { url: "https://example.com" } },
      {
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      server.protocolDeps,
    );

    const taskReq = WsTaskExecuteRequest.parse(
      await withTimeout(taskExecuteP, 5_000, "task_execute"),
    );
    expect(taskReq.request_id).toBe(taskId);

    // Client -> gateway response
    client.respondTaskExecute(taskId, true, undefined, { statusCode: 200 });
    const taskResult = await withTimeout(taskResultP, 5_000, "onTaskResult");
    expect(taskResult.taskId).toBe(taskId);
    expect(taskResult.success).toBe(true);

    const dispatchMsg = mustFind(
      server.gatewayToClient,
      (m) => isRequestOfType(m, "task.execute"),
      "task.execute request",
    );
    const resultMsg = mustFind(
      server.clientToGateway,
      (m) => isResponseOfType(m, "task.execute") && isRecord(m) && m["request_id"] === taskId,
      "task.execute response",
    );

    WsTaskExecuteRequest.parse(dispatchMsg);
    WsTaskExecuteResponseEnvelope.parse(resultMsg);
  });

  it("connect.init/connect.proof handshake frames conform to @tyrum/schemas contracts", async () => {
    server = await startInstrumentedGateway((connectionManager) => ({ connectionManager }));

    client = new TyrumClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: server.adminToken,
      capabilities: ["http"],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await withTimeout(connectedP, 5_000, "connected");
    await delay(25);

    const initReq = mustFind(
      server.clientToGateway,
      (m) => isRequestOfType(m, "connect.init"),
      "connect.init request",
    );
    const initRes = mustFind(
      server.gatewayToClient,
      (m) => isResponseOfType(m, "connect.init"),
      "connect.init response",
    );
    const proofReq = mustFind(
      server.clientToGateway,
      (m) => isRequestOfType(m, "connect.proof"),
      "connect.proof request",
    );
    const proofRes = mustFind(
      server.gatewayToClient,
      (m) => isResponseOfType(m, "connect.proof"),
      "connect.proof response",
    );

    WsConnectInitRequest.parse(initReq);
    WsConnectInitResponseEnvelope.parse(initRes);
    WsConnectProofRequest.parse(proofReq);
    WsConnectProofResponseEnvelope.parse(proofRes);
  });
});
