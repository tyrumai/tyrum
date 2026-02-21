import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsPairingApprovedEvent } from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { dispatchTask, NoCapableClientError } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";

function deriveEnrollmentToken(adminToken: string): string {
  return createHash("sha256")
    .update(`tyrum-node-enrollment-v1|${adminToken}`, "utf-8")
    .digest("hex");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    }),
  ]);
}

describe("node scoped tokens", () => {
  let server: Server | undefined;
  let db: SqliteDb | undefined;
  let homeDir: string | undefined;
  let nodeHomeDir: string | undefined;
  let stopHeartbeat: (() => void) | undefined;

  afterEach(async () => {
    stopHeartbeat?.();
    stopHeartbeat = undefined;

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    await db?.close();
    db = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
    if (nodeHomeDir) {
      await rm(nodeHomeDir, { recursive: true, force: true });
      nodeHomeDir = undefined;
    }
  });

  it("connects pending→approve→execute→revoke with scoped tokens", async () => {
    db = openTestSqliteDb();

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-node-token-test-"));
    nodeHomeDir = await mkdtemp(join(tmpdir(), "tyrum-node-home-"));

    const tokenStore = new TokenStore(homeDir);
    const adminToken = await tokenStore.initialize();
    const enrollmentToken = deriveEnrollmentToken(adminToken);

    const connectionManager = new ConnectionManager();
    const taskResults: Array<{
      taskId: string;
      success: boolean;
      evidence: unknown;
      error: string | undefined;
    }> = [];

    const protocolDeps: ProtocolDeps = {
      connectionManager,
      onTaskResult(taskId, success, evidence, error) {
        taskResults.push({ taskId, success, evidence, error });
      },
    };

    const wsHandler = createWsHandler({
      connectionManager,
      protocolDeps,
      tokenStore,
      db,
      nodeAutoApproveLoopback: false,
    });
    stopHeartbeat = wsHandler.stopHeartbeat;

    server = createServer();
    server.on("upgrade", (req, socket, head) => {
      wsHandler.handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // 1) Unpaired node connects with enrollment token, but cannot execute capabilities.
    const nodePending = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: enrollmentToken,
      capabilities: ["cli"],
      role: "node",
      reconnect: false,
      tyrumHome: nodeHomeDir,
    });

    const pendingConnectedP = new Promise<{ instanceId: string }>((resolve) => {
      nodePending.on("connected", (info) => resolve({ instanceId: info.instanceId }));
    });

    nodePending.connect();
    const { instanceId: nodeId } = await withTimeout(pendingConnectedP, 5_000, "pending node connect");
    await delay(50);

    expect(connectionManager.getClientForCapability("cli")).toBeUndefined();
    expect(() =>
      dispatchTask(
        { type: "CLI", args: { cmd: "echo", args: ["hello"] } },
        { runId: crypto.randomUUID(), stepId: crypto.randomUUID(), attemptId: crypto.randomUUID() },
        protocolDeps,
      ),
    ).toThrow(NoCapableClientError);

    // 2) Operator approves pairing; node is forced to reconnect.
    const operatorHome = await mkdtemp(join(tmpdir(), "tyrum-operator-home-"));
    const operator = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: adminToken,
      capabilities: [],
      role: "client",
      reconnect: false,
      tyrumHome: operatorHome,
    });

    const operatorConnectedP = new Promise<void>((resolve) => {
      operator.on("connected", () => resolve());
    });
    operator.connect();
    await withTimeout(operatorConnectedP, 5_000, "operator connect");

    const pendingDisconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      nodePending.on("disconnected", resolve);
    });

    await operator.pairingApprove({ node_id: nodeId, reason: "test approve" });

    const pendingDisconnected = await withTimeout(pendingDisconnectedP, 5_000, "pending disconnect after approve");
    expect(pendingDisconnected.code).toBe(1012);
    nodePending.disconnect();

    // 3) Node reconnects with enrollment token → gateway issues scoped token and forces reconnect.
    const nodeEnroll = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: enrollmentToken,
      capabilities: ["cli"],
      role: "node",
      reconnect: false,
      tyrumHome: nodeHomeDir,
    });

    const approvedP = new Promise<unknown>((resolve) => {
      nodeEnroll.on("pairing_approved", resolve);
    });
    const enrollDisconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      nodeEnroll.on("disconnected", resolve);
    });

    nodeEnroll.connect();

    const approved = WsPairingApprovedEvent.parse(
      await withTimeout(approvedP, 5_000, "pairing_approved"),
    );
    const scopedToken = String(approved.payload.scoped_token);

    const enrollDisconnected = await withTimeout(enrollDisconnectedP, 5_000, "enroll disconnect after approved");
    expect(enrollDisconnected.code).toBe(1012);
    nodeEnroll.disconnect();

    // 4) Node connects with scoped token and can execute.
    const nodeScoped = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: scopedToken,
      capabilities: ["cli"],
      role: "node",
      reconnect: false,
      tyrumHome: nodeHomeDir,
    });

    nodeScoped.on("task_execute", (req) => {
      nodeScoped.respondTaskExecute(req.request_id, true, { ok: true }, { handled: true }, undefined);
    });

    const scopedConnectedP = new Promise<void>((resolve) => {
      nodeScoped.on("connected", () => resolve());
    });
    const scopedDisconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      nodeScoped.on("disconnected", resolve);
    });

    nodeScoped.connect();
    await withTimeout(scopedConnectedP, 5_000, "scoped node connect");
    await delay(50);

    const capable = connectionManager.getClientForCapability("cli");
    expect(capable).toBeDefined();
    expect(capable!.role).toBe("node");
    expect(capable!.instance_id).toBe(nodeId);

    const taskId = await dispatchTask(
      { type: "CLI", args: { cmd: "echo", args: ["hello", "world"] } },
      { runId: crypto.randomUUID(), stepId: crypto.randomUUID(), attemptId: crypto.randomUUID() },
      protocolDeps,
    );

    const taskResult = await withTimeout(
      (async () => {
        const deadline = Date.now() + 2_000;
        while (Date.now() <= deadline) {
          const hit = taskResults.find((r) => r.taskId === taskId);
          if (hit) return hit;
          await delay(25);
        }
        throw new Error("task result timeout");
      })(),
      5_000,
      "task result",
    );
    expect(taskResult.success).toBe(true);

    // 5) Revoke pairing → node disconnects and capability execution is blocked.
    await operator.pairingRevoke({ node_id: nodeId, reason: "test revoke" });

    const scopedDisconnected = await withTimeout(scopedDisconnectedP, 5_000, "scoped disconnect after revoke");
    expect(scopedDisconnected.code).toBe(1012);
    await delay(50);
    expect(connectionManager.getClientForCapability("cli")).toBeUndefined();
    expect(() =>
      dispatchTask(
        { type: "CLI", args: { cmd: "echo", args: ["blocked"] } },
        { runId: crypto.randomUUID(), stepId: crypto.randomUUID(), attemptId: crypto.randomUUID() },
        protocolDeps,
      ),
    ).toThrow(NoCapableClientError);

    // 6) Scoped token should be rejected after revoke.
    const nodeRevoked = new TyrumClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: scopedToken,
      capabilities: ["cli"],
      role: "node",
      reconnect: false,
      tyrumHome: nodeHomeDir,
    });

    const revokedDisconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      nodeRevoked.on("disconnected", resolve);
    });

    nodeRevoked.connect();
    const revokedDisconnected = await withTimeout(revokedDisconnectedP, 5_000, "revoked disconnect");
    expect(revokedDisconnected.code).toBe(4001);

    nodeScoped.disconnect();
    nodeRevoked.disconnect();

    operator.disconnect();
    await rm(operatorHome, { recursive: true, force: true });
  });
});

