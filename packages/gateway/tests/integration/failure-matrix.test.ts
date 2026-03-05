import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  deviceIdFromSha256Digest,
} from "@tyrum/schemas";

import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { startExecutionWorkerLoop } from "../../src/modules/execution/worker-loop.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { ConnectionDirectoryDal } from "../../src/modules/backplane/connection-directory.js";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { dispatchTask } from "../../src/ws/protocol.js";
import { NoCapableNodeError } from "../../src/ws/protocol/errors.js";
import { WatcherFiringDal } from "../../src/modules/watcher/firing-dal.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return deviceIdFromSha256Digest(digest);
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

async function listen(
  handler: ReturnType<typeof createWsHandler>,
): Promise<{ server: Server; port: number }> {
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    handler.handleUpgrade(req, socket, head);
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return { server, port };
}

async function connectClientWithProof(input: {
  port: number;
  token: string;
  role: "client" | "node";
  capabilities: Array<"cli" | "playwright" | "android" | "desktop" | "http">;
}): Promise<{ ws: WebSocket; connectionId: string; deviceId: string }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const pubkey = pubkeyDer.toString("base64url");
  const deviceId = computeDeviceId(pubkeyDer);

  const ws = new WebSocket(`ws://127.0.0.1:${input.port}/ws`, authProtocols(input.token));
  await waitForOpen(ws);

  ws.send(
    JSON.stringify({
      request_id: "r-init",
      type: "connect.init",
      payload: {
        protocol_rev: 2,
        role: input.role,
        device: { device_id: deviceId, pubkey, label: "test" },
        capabilities: input.capabilities.map((capability) => ({
          id: descriptorIdForClientCapability(capability),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        })),
      },
    }),
  );

  const initRes = await waitForJsonMessageMatching(
    ws,
    (msg) => msg["type"] === "connect.init" && msg["ok"] === true,
    5_000,
    "connect.init",
  );
  const initResult = initRes["result"] as Record<string, unknown>;
  const connectionId = String(initResult["connection_id"]);
  const challenge = String(initResult["challenge"]);
  expect(connectionId).toBeTruthy();
  expect(challenge).toBeTruthy();

  const transcript = buildTranscript({
    protocolRev: 2,
    role: input.role,
    deviceId,
    connectionId,
    challenge,
  });
  const proof = sign(null, transcript, privateKey).toString("base64url");

  ws.send(
    JSON.stringify({
      request_id: "r-proof",
      type: "connect.proof",
      payload: { connection_id: connectionId, proof },
    }),
  );

  const proofRes = await waitForJsonMessageMatching(
    ws,
    (msg) => msg["type"] === "connect.proof" && msg["ok"] === true,
    5_000,
    "connect.proof",
  );
  const proofResult = proofRes["result"] as Record<string, unknown>;
  expect(String(proofResult["client_id"])).toBe(connectionId);
  expect(String(proofResult["device_id"])).toBe(deviceId);

  return { ws, connectionId, deviceId };
}

describe("Failure matrix (scaling-ha)", () => {
  const connectionsTtlMs = 50;
  const approvedCliPairingDal = {
    getByNodeId: async () =>
      ({
        status: "approved",
        capability_allowlist: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }) as never,
  } as never;

  let dirs: string[] = [];
  let dbs: SqliteDb[] = [];
  let servers: Server[] = [];
  let heartbeats: Array<() => void> = [];
  let sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    sockets = [];

    for (const stop of heartbeats) {
      stop();
    }
    heartbeats = [];

    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    servers = [];

    for (const db of dbs) {
      await db.close();
    }
    dbs = [];

    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it("routes ws.direct across edges and cleans up stale connection directory entries after edge failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-ws-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const dbA = openTestSqliteDb(dbPath);
    const dbB = openTestSqliteDb(dbPath);
    dbs.push(dbA, dbB);

    const tokenStore = new TokenStore(join(dir, "tokens"));
    const token = await tokenStore.initialize();

    const cmA = new ConnectionManager();
    const cdA = new ConnectionDirectoryDal(dbA);
    const outboxA = new OutboxDal(dbA);
    const pollerA = new OutboxPoller({
      consumerId: "edge-a",
      outboxDal: outboxA,
      connectionManager: cmA,
    });
    await outboxA.ensureConsumer("edge-a");

    const wsHandlerA = createWsHandler({
      connectionManager: cmA,
      protocolDeps: { connectionManager: cmA },
      tokenStore,
      cluster: {
        instanceId: "edge-a",
        connectionDirectory: cdA,
        connectionTtlMs: connectionsTtlMs,
      },
    });
    heartbeats.push(wsHandlerA.stopHeartbeat);

    const { server: serverA, port: portA } = await listen(wsHandlerA);
    servers.push(serverA);

    const cmB = new ConnectionManager();
    const cdB = new ConnectionDirectoryDal(dbB);
    const outboxB = new OutboxDal(dbB);
    const pollerB = new OutboxPoller({
      consumerId: "edge-b",
      outboxDal: outboxB,
      connectionManager: cmB,
    });
    await outboxB.ensureConsumer("edge-b");

    const wsHandlerB = createWsHandler({
      connectionManager: cmB,
      protocolDeps: { connectionManager: cmB },
      tokenStore,
      cluster: {
        instanceId: "edge-b",
        connectionDirectory: cdB,
        connectionTtlMs: connectionsTtlMs,
      },
    });
    heartbeats.push(wsHandlerB.stopHeartbeat);

    const { server: serverB, port: portB } = await listen(wsHandlerB);
    servers.push(serverB);

    const { ws: clientA } = await connectClientWithProof({
      port: portA,
      token,
      role: "node",
      capabilities: ["cli"],
    });
    sockets.push(clientA);

    // Verify directory registration for edge-a.
    const listA1 = await cdA.listConnectionsForCapability("cli", Date.now());
    expect(listA1.length).toBe(1);
    expect(listA1[0]!.edge_id).toBe("edge-a");

    // Directed routing: edge-b dispatches to the capable peer owned by edge-a via outbox.
    const taskScopeX = {
      runId: "550e8400-e29b-41d4-a716-446655440000",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    };
    await dispatchTask({ type: "CLI", args: {} }, taskScopeX, {
      connectionManager: cmB,
      nodePairingDal: approvedCliPairingDal,
      cluster: { edgeId: "edge-b", outboxDal: outboxB, connectionDirectory: cdB },
    } as never);
    await pollerA.tick();

    const taskMsg = await waitForJsonMessageMatching(
      clientA,
      (msg) => msg["type"] === "task.execute",
      5_000,
      "task.execute",
    );
    expect((taskMsg["payload"] as Record<string, unknown>)["run_id"]).toBe(taskScopeX.runId);

    // Simulate edge-a crash by stopping its directory heartbeat; entry should expire and be cleaned up by other edges.
    wsHandlerA.stopHeartbeat();

    await delay(connectionsTtlMs + 25);
    expect(await cdB.cleanupExpired(Date.now())).toBe(1);

    // With no directory entries, dispatch should fail (at-least-once semantics require re-resolve on reconnect).
    await expect(
      dispatchTask({ type: "CLI", args: {} }, taskScopeX, {
        connectionManager: cmB,
        nodePairingDal: approvedCliPairingDal,
        cluster: { edgeId: "edge-b", outboxDal: outboxB, connectionDirectory: cdB },
      } as never),
    ).rejects.toBeInstanceOf(NoCapableNodeError);

    // Client reconnects to edge-b; routing should now target edge-b.
    clientA.close();
    const { ws: clientB } = await connectClientWithProof({
      port: portB,
      token,
      role: "node",
      capabilities: ["cli"],
    });
    sockets.push(clientB);

    const listB = await cdB.listConnectionsForCapability("cli", Date.now());
    expect(listB.length).toBe(1);
    expect(listB[0]!.edge_id).toBe("edge-b");

    const taskScopeZ = {
      runId: "550e8400-e29b-41d4-a716-446655440002",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    };
    await dispatchTask({ type: "CLI", args: {} }, taskScopeZ, {
      connectionManager: cmA,
      nodePairingDal: approvedCliPairingDal,
      cluster: { edgeId: "edge-a", outboxDal: outboxA, connectionDirectory: cdA },
    } as never);
    await pollerB.tick();

    const taskMsg2 = await waitForJsonMessageMatching(
      clientB,
      (msg) => msg["type"] === "task.execute",
      5_000,
      "task.execute edge-b",
    );
    expect((taskMsg2["payload"] as Record<string, unknown>)["run_id"]).toBe(taskScopeZ.runId);
  });

  it("recovers ws.direct routing after edge crash+restart (client reconnects; directory + outbox resume)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-edge-restart-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const tokenStore = new TokenStore(join(dir, "tokens"));
    const token = await tokenStore.initialize();

    const dbA1 = openTestSqliteDb(dbPath);
    const dbB = openTestSqliteDb(dbPath);
    dbs.push(dbA1, dbB);

    const startEdge = async (edgeId: string, db: SqliteDb) => {
      const connectionManager = new ConnectionManager();
      const connectionDirectory = new ConnectionDirectoryDal(db);
      const outboxDal = new OutboxDal(db);
      const outboxPoller = new OutboxPoller({ consumerId: edgeId, outboxDal, connectionManager });
      await outboxDal.ensureConsumer(edgeId);

      const wsHandler = createWsHandler({
        connectionManager,
        protocolDeps: { connectionManager },
        tokenStore,
        cluster: { instanceId: edgeId, connectionDirectory, connectionTtlMs: connectionsTtlMs },
      });
      heartbeats.push(wsHandler.stopHeartbeat);

      const { server, port } = await listen(wsHandler);
      servers.push(server);

      return { connectionManager, connectionDirectory, outboxDal, outboxPoller, wsHandler, port };
    };

    const edgeA1 = await startEdge("edge-a", dbA1);
    const edgeB = await startEdge("edge-b", dbB);

    const { ws: clientA1 } = await connectClientWithProof({
      port: edgeA1.port,
      token,
      role: "node",
      capabilities: ["cli"],
    });
    sockets.push(clientA1);

    const listA1 = await edgeA1.connectionDirectory.listConnectionsForCapability("cli", Date.now());
    expect(listA1.length).toBe(1);
    expect(listA1[0]!.edge_id).toBe("edge-a");

    const taskScope1 = {
      runId: "550e8400-e29b-41d4-a716-446655440010",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    };
    await dispatchTask({ type: "CLI", args: {} }, taskScope1, {
      connectionManager: edgeB.connectionManager,
      nodePairingDal: approvedCliPairingDal,
      cluster: {
        edgeId: "edge-b",
        outboxDal: edgeB.outboxDal,
        connectionDirectory: edgeB.connectionDirectory,
      },
    } as never);
    await edgeA1.outboxPoller.tick();

    const msg1 = await waitForJsonMessageMatching(
      clientA1,
      (msg) => msg["type"] === "task.execute",
      5_000,
      "task.execute (pre-restart)",
    );
    expect((msg1["payload"] as Record<string, unknown>)["run_id"]).toBe(taskScope1.runId);

    // Simulate a hard edge crash by stopping directory heartbeats. The stale entry must be cleaned up by other edges.
    edgeA1.wsHandler.stopHeartbeat();
    await delay(connectionsTtlMs + 25);
    expect(await edgeB.connectionDirectory.cleanupExpired(Date.now())).toBe(1);

    await expect(
      dispatchTask({ type: "CLI", args: {} }, taskScope1, {
        connectionManager: edgeB.connectionManager,
        nodePairingDal: approvedCliPairingDal,
        cluster: {
          edgeId: "edge-b",
          outboxDal: edgeB.outboxDal,
          connectionDirectory: edgeB.connectionDirectory,
        },
      } as never),
    ).rejects.toBeInstanceOf(NoCapableNodeError);

    clientA1.close();

    const dbA2 = openTestSqliteDb(dbPath);
    dbs.push(dbA2);
    const edgeA2 = await startEdge("edge-a", dbA2);

    const { ws: clientA2 } = await connectClientWithProof({
      port: edgeA2.port,
      token,
      role: "node",
      capabilities: ["cli"],
    });
    sockets.push(clientA2);

    const listA2 = await edgeA2.connectionDirectory.listConnectionsForCapability("cli", Date.now());
    expect(listA2.length).toBe(1);
    expect(listA2[0]!.edge_id).toBe("edge-a");

    const taskScope2 = {
      runId: "550e8400-e29b-41d4-a716-446655440011",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    };
    await dispatchTask({ type: "CLI", args: {} }, taskScope2, {
      connectionManager: edgeB.connectionManager,
      nodePairingDal: approvedCliPairingDal,
      cluster: {
        edgeId: "edge-b",
        outboxDal: edgeB.outboxDal,
        connectionDirectory: edgeB.connectionDirectory,
      },
    } as never);
    await edgeA2.outboxPoller.tick();

    const msg2 = await waitForJsonMessageMatching(
      clientA2,
      (msg) => msg["type"] === "task.execute",
      5_000,
      "task.execute (post-restart)",
    );
    expect((msg2["payload"] as Record<string, unknown>)["run_id"]).toBe(taskScope2.runId);
  });

  it("recovers from worker crash mid-attempt via lease expiry/takeover", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-worker-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const db1 = openTestSqliteDb(dbPath);
    const db2 = openTestSqliteDb(dbPath);
    dbs.push(db1, db2);

    const engine1 = new ExecutionEngine({ db: db1, concurrencyLimits: { global: 1 } });

    let nowMs = Date.now();
    const engine2 = new ExecutionEngine({
      db: db2,
      concurrencyLimits: { global: 1 },
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
    });

    const { runId } = await engine1.enqueuePlan({
      key: "agent:default:ui:thread-worker-1",
      lane: "main",
      planId: "plan-worker-1",
      requestId: "req-worker-1",
      steps: [{ type: "CLI", args: {} }],
    });

    const step = await db2.get<{ step_id: string; max_attempts: number; timeout_ms: number }>(
      "SELECT step_id, max_attempts, timeout_ms FROM execution_steps WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(step?.step_id).toBeTruthy();

    // Simulate an in-flight attempt owned by a dead worker with a short lease.
    const attemptId = "attempt-dead-1";
    const leaseExpiresAt = nowMs + 25;
    await db2.run(
      "UPDATE execution_steps SET status = 'running' WHERE tenant_id = ? AND step_id = ?",
      [DEFAULT_TENANT_ID, step!.step_id],
    );
    await db2.run(
      `INSERT INTO execution_attempts (
         tenant_id, attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms
       ) VALUES (?, ?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
      [DEFAULT_TENANT_ID, attemptId, step!.step_id, new Date(nowMs).toISOString(), leaseExpiresAt],
    );
    await db2.run(
      `INSERT INTO concurrency_slots (
         tenant_id, scope, scope_id, slot, lease_owner, lease_expires_at_ms, attempt_id
       )
       VALUES (?, 'global', 'global', 0, 'dead-worker', ?, ?)
       ON CONFLICT (tenant_id, scope, scope_id, slot) DO UPDATE SET
         lease_owner = excluded.lease_owner,
         lease_expires_at_ms = excluded.lease_expires_at_ms,
         attempt_id = excluded.attempt_id`,
      [DEFAULT_TENANT_ID, leaseExpiresAt, attemptId],
    );

    const fastExecutor: StepExecutor = {
      execute: async (): Promise<StepResult> => ({ success: true, result: { ok: true } }),
    };

    // Before expiry: no takeover.
    expect(await engine2.workerTick({ workerId: "w2", executor: fastExecutor })).toBe(false);

    // After expiry: engine cancels stale attempt and re-queues work.
    nowMs += 100;
    expect(await engine2.workerTick({ workerId: "w2", executor: fastExecutor })).toBe(true);

    const cancelled = await db2.get<{ status: string }>(
      "SELECT status FROM execution_attempts WHERE tenant_id = ? AND attempt_id = ?",
      [DEFAULT_TENANT_ID, attemptId],
    );
    expect(cancelled?.status).toBe("cancelled");

    const slot = await db2.get<{ attempt_id: string | null }>(
      `SELECT attempt_id
       FROM concurrency_slots
       WHERE tenant_id = ? AND scope = 'global' AND scope_id = 'global' AND slot = 0`,
      [DEFAULT_TENANT_ID],
    );
    expect(slot?.attempt_id).toBeNull();

    // Next tick executes the recovered step and completes the run.
    for (let i = 0; i < 10; i += 1) {
      const worked = await engine2.workerTick({ workerId: "w2", executor: fastExecutor });
      if (!worked) break;
    }

    const run = await db2.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(run?.status).toBe("succeeded");
  });

  it("serializes execution per (key, lane) using lane leases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-lanes-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const db1 = openTestSqliteDb(dbPath);
    const db2 = openTestSqliteDb(dbPath);
    dbs.push(db1, db2);

    const engine1 = new ExecutionEngine({ db: db1 });
    const engine2 = new ExecutionEngine({ db: db2 });

    const key = "agent:default:lane-test:main";
    const lane = "main";

    const run1 = await engine1.enqueuePlan({
      key,
      lane,
      planId: "plan-lane-1",
      requestId: "req-lane-1",
      steps: [{ type: "CLI", args: {} }],
    });
    const run2 = await engine1.enqueuePlan({
      key,
      lane,
      planId: "plan-lane-2",
      requestId: "req-lane-2",
      steps: [{ type: "CLI", args: {} }],
    });

    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let isFirst = true;
    const executor: StepExecutor = {
      execute: async (): Promise<StepResult> => {
        if (isFirst) {
          isFirst = false;
          await firstGate;
        }
        return { success: true, result: { ok: true } };
      },
    };

    const p1 = engine1.workerTick({ workerId: "w1", executor });
    await delay(25);

    const blocked = await engine2.workerTick({ workerId: "w2", executor });
    expect(blocked).toBe(false);

    const run2StatusBefore = await db2.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, run2.runId],
    );
    expect(run2StatusBefore?.status).toBe("queued");

    releaseFirst?.();
    await p1;

    // The engine finalizes runs (and releases lane leases) on a follow-up tick.
    await engine1.workerTick({ workerId: "w1", executor });

    const progressed = await engine2.workerTick({ workerId: "w2", executor });
    expect(progressed).toBe(true);
    await engine2.workerTick({ workerId: "w2", executor });

    const statuses = await db2.all<{ run_id: string; status: string }>(
      "SELECT run_id, status FROM execution_runs WHERE tenant_id = ? AND run_id IN (?, ?)",
      [DEFAULT_TENANT_ID, run1.runId, run2.runId],
    );
    const byId = new Map(statuses.map((r) => [r.run_id, r.status]));
    expect(byId.get(run1.runId)).toBe("succeeded");
    expect(byId.get(run2.runId)).toBe("succeeded");
  });

  it("transfers scheduler work after crash via firing leases (no double-fires)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-scheduler-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const db = openTestSqliteDb(dbPath);
    dbs.push(db);

    // Minimal watcher + firing.
    const watcherId = randomUUID();
    await db.run(
      `INSERT INTO watchers (tenant_id, watcher_id, watcher_key, agent_id, workspace_id, trigger_type, trigger_config_json)
       VALUES (?, ?, ?, ?, ?, 'periodic', ?)`,
      [
        DEFAULT_TENANT_ID,
        watcherId,
        `watcher-${watcherId}`,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        JSON.stringify({ intervalMs: 1000, planId: "plan-1" }),
      ],
    );

    const dal = new WatcherFiringDal(db);
    const nowMs = Date.now();
    const slotMs = Math.floor(nowMs / 1000) * 1000;
    const firingId = randomUUID();
    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId,
      scheduledAtMs: slotMs,
    });

    // Scheduler A claims and then "crashes" before marking enqueued.
    const claimedA = await dal.claimNext({ owner: "sched-a", nowMs: slotMs, leaseTtlMs: 25 });
    expect(claimedA?.lease_owner).toBe("sched-a");

    // Scheduler B cannot claim until lease expires.
    const blocked = await dal.claimNext({ owner: "sched-b", nowMs: slotMs + 1, leaseTtlMs: 25 });
    expect(blocked).toBeUndefined();

    // After expiry, scheduler B takes over and marks enqueued.
    const claimedB = await dal.claimNext({ owner: "sched-b", nowMs: slotMs + 50, leaseTtlMs: 25 });
    expect(claimedB?.lease_owner).toBe("sched-b");
    expect(
      await dal.markEnqueued({
        tenantId: DEFAULT_TENANT_ID,
        watcherFiringId: firingId,
        owner: "sched-b",
      }),
    ).toBe(true);

    const row = await dal.getById({ tenantId: DEFAULT_TENANT_ID, watcherFiringId: firingId });
    expect(row?.status).toBe("enqueued");

    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM watcher_firings
       WHERE tenant_id = ? AND watcher_id = ? AND scheduled_at_ms = ?`,
      [DEFAULT_TENANT_ID, watcherId, slotMs],
    );
    expect(count?.n).toBe(1);
  });

  it("tolerates transient DB failures in watcher scheduler interval (scheduler↔DB partition)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-scheduler-db-partition-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const db = openTestSqliteDb(dbPath);
    dbs.push(db);

    const watcherId = randomUUID();
    await db.run(
      `INSERT INTO watchers (tenant_id, watcher_id, watcher_key, agent_id, workspace_id, trigger_type, trigger_config_json)
       VALUES (?, ?, ?, ?, ?, 'periodic', ?)`,
      [
        DEFAULT_TENANT_ID,
        watcherId,
        `watcher-${watcherId}`,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        JSON.stringify({ intervalMs: 1000, planId: "plan-1" }),
      ],
    );

    let allCalls = 0;
    let failAllOnce = true;
    const flakyDb = {
      kind: "sqlite" as const,
      get: db.get.bind(db),
      run: db.run.bind(db),
      exec: db.exec.bind(db),
      transaction: db.transaction.bind(db),
      all: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
        allCalls += 1;
        if (failAllOnce) {
          failAllOnce = false;
          throw new Error("db down");
        }
        return await db.all<T>(sql, params);
      },
    } as unknown as SqliteDb;

    const scheduler = new WatcherScheduler({
      db: flakyDb,
      memoryV1Dal: { create: async () => ({}) } as never,
      eventBus: { emit: () => undefined } as never,
      tickMs: 10,
    });

    scheduler.start();
    try {
      const deadlineMs = Date.now() + 1_000;
      let enqueued = false;
      while (Date.now() < deadlineMs) {
        const firing = await db.get<{ status: string }>(
          "SELECT status FROM watcher_firings ORDER BY scheduled_at_ms ASC LIMIT 1",
        );
        if (firing?.status === "enqueued") {
          enqueued = true;
          break;
        }
        await delay(10);
      }
      expect(allCalls).toBeGreaterThan(0);
      expect(enqueued).toBe(true);
    } finally {
      scheduler.stop();
    }
  });

  it("replays ws.direct outbox rows after DB restart between poll and ack (at-least-once)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-failure-matrix-db-restart-outbox-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.db");

    const db1 = openTestSqliteDb(dbPath);
    dbs.push(db1);

    const tokenStore = new TokenStore(join(dir, "tokens"));
    const token = await tokenStore.initialize();

    const connectionManager = new ConnectionManager();
    const wsHandler = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      tokenStore,
    });
    heartbeats.push(wsHandler.stopHeartbeat);

    const { server, port } = await listen(wsHandler);
    servers.push(server);

    const { ws, connectionId } = await connectClientWithProof({
      port,
      token,
      role: "client",
      capabilities: ["cli"],
    });
    sockets.push(ws);

    const consumerId = "edge-db-restart";
    const outboxDal1 = new OutboxDal(db1);
    await outboxDal1.ensureConsumer(consumerId);

    const runId = "550e8400-e29b-41d4-a716-446655440020";
    const message = {
      request_id: "task-db-restart",
      type: "task.execute",
      payload: {
        run_id: runId,
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "CLI", args: {} },
      },
    };

    const row = await outboxDal1.enqueue(
      "ws.direct",
      { connection_id: connectionId, message },
      { targetEdgeId: consumerId },
    );

    let db2: SqliteDb | undefined;
    let outboxDal2: OutboxDal | undefined;
    let didRestart = false;
    let didFailAck = false;

    const restartingOutboxDal = {
      poll: async (id: string, batchSize?: number) => {
        if (didRestart) {
          return await outboxDal2!.poll(id, batchSize);
        }
        const rows = await outboxDal1.poll(id, batchSize);

        // Simulate DB restart after the poll but before the ack.
        await db1.close();
        dbs = dbs.filter((db) => db !== db1);

        db2 = openTestSqliteDb(dbPath);
        dbs.push(db2);
        outboxDal2 = new OutboxDal(db2);
        didRestart = true;

        return rows;
      },
      ackConsumerCursor: async (id: string, lastOutboxId: number) => {
        if (didRestart && !didFailAck) {
          didFailAck = true;
          return await outboxDal1.ackConsumerCursor(id, lastOutboxId);
        }
        return await outboxDal2!.ackConsumerCursor(id, lastOutboxId);
      },
      ensureConsumer: async (id: string) => {
        if (didRestart) {
          await outboxDal2!.ensureConsumer(id);
          return;
        }
        await outboxDal1.ensureConsumer(id);
      },
    } as unknown as OutboxDal;

    const poller = new OutboxPoller({
      consumerId,
      outboxDal: restartingOutboxDal,
      connectionManager,
    });

    const firstMsgPromise = waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "task.execute" &&
        (msg["payload"] as Record<string, unknown>)["run_id"] === runId,
      5_000,
      "task.execute (first)",
    );
    await poller.tick();
    await firstMsgPromise;

    const replayMsgPromise = waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "task.execute" &&
        (msg["payload"] as Record<string, unknown>)["run_id"] === runId,
      5_000,
      "task.execute (replay)",
    );
    await poller.tick();
    await replayMsgPromise;

    const cursor = await db2!.get<{ last_outbox_id: number }>(
      "SELECT last_outbox_id FROM outbox_consumers WHERE consumer_id = ?",
      [consumerId],
    );
    expect(cursor?.last_outbox_id).toBe(row.id);
  });

  it("tolerates transient DB failures in outbox polling (edge↔DB partition)", async () => {
    const connectionManager = new ConnectionManager();
    const failingOutboxDal = {
      poll: async () => {
        throw new Error("db down");
      },
      ackConsumerCursor: async () => undefined,
      ensureConsumer: async () => undefined,
    } as unknown as OutboxDal;

    const poller = new OutboxPoller({
      consumerId: "edge-x",
      outboxDal: failingOutboxDal,
      connectionManager,
    });

    await poller.tick();
  });

  it("tolerates transient DB failures in worker loop (worker↔DB partition)", async () => {
    let ticks = 0;
    const failingEngine = {
      workerTick: async () => {
        ticks += 1;
        throw new Error("db down");
      },
    } as unknown as ExecutionEngine;

    const executor: StepExecutor = {
      execute: async (): Promise<StepResult> => ({ success: true, result: { ok: true } }),
    };

    const loop = startExecutionWorkerLoop({
      engine: failingEngine,
      workerId: "w-db-partition",
      executor,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    await delay(50);
    expect(ticks).toBeGreaterThan(0);

    loop.stop();
    await loop.done;
  });
});
