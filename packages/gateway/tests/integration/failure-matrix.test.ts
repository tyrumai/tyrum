import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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
import { dispatchTask, NoCapableClientError } from "../../src/ws/protocol.js";
import { WatcherFiringDal } from "../../src/modules/watcher/firing-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function authProtocols(token: string): string[] {
  return [
    "tyrum-v1",
    `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`,
  ];
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

async function listen(handler: ReturnType<typeof createWsHandler>): Promise<{ server: Server; port: number }> {
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
    const pollerA = new OutboxPoller({ consumerId: "edge-a", outboxDal: outboxA, connectionManager: cmA });
    await outboxA.ensureConsumer("edge-a");

    const wsHandlerA = createWsHandler({
      connectionManager: cmA,
      protocolDeps: { connectionManager: cmA },
      tokenStore,
      cluster: { instanceId: "edge-a", connectionDirectory: cdA, connectionTtlMs: connectionsTtlMs },
    });
    heartbeats.push(wsHandlerA.stopHeartbeat);

    const { server: serverA, port: portA } = await listen(wsHandlerA);
    servers.push(serverA);

    const cmB = new ConnectionManager();
    const cdB = new ConnectionDirectoryDal(dbB);
    const outboxB = new OutboxDal(dbB);
    const pollerB = new OutboxPoller({ consumerId: "edge-b", outboxDal: outboxB, connectionManager: cmB });
    await outboxB.ensureConsumer("edge-b");

    const wsHandlerB = createWsHandler({
      connectionManager: cmB,
      protocolDeps: { connectionManager: cmB },
      tokenStore,
      cluster: { instanceId: "edge-b", connectionDirectory: cdB, connectionTtlMs: connectionsTtlMs },
    });
    heartbeats.push(wsHandlerB.stopHeartbeat);

    const { server: serverB, port: portB } = await listen(wsHandlerB);
    servers.push(serverB);

    const { ws: clientA } = await connectClientWithProof({
      port: portA,
      token,
      role: "client",
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
        cluster: { edgeId: "edge-b", outboxDal: outboxB, connectionDirectory: cdB },
      } as never),
    ).rejects.toBeInstanceOf(NoCapableClientError);

    // Client reconnects to edge-b; routing should now target edge-b.
    clientA.close();
    const { ws: clientB } = await connectClientWithProof({
      port: portB,
      token,
      role: "client",
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
      "SELECT step_id, max_attempts, timeout_ms FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step?.step_id).toBeTruthy();

    // Simulate an in-flight attempt owned by a dead worker with a short lease.
    const attemptId = "attempt-dead-1";
    const leaseExpiresAt = nowMs + 25;
    await db2.run("UPDATE execution_steps SET status = 'running' WHERE step_id = ?", [step!.step_id]);
    await db2.run(
      `INSERT INTO execution_attempts (
         attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms
       ) VALUES (?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
      [attemptId, step!.step_id, new Date(nowMs).toISOString(), leaseExpiresAt],
    );
    await db2.run(
      `INSERT INTO concurrency_slots (scope, scope_id, slot, lease_owner, lease_expires_at_ms, attempt_id)
       VALUES ('global', 'global', 0, 'dead-worker', ?, ?)
       ON CONFLICT (scope, scope_id, slot) DO UPDATE SET
         lease_owner = excluded.lease_owner,
         lease_expires_at_ms = excluded.lease_expires_at_ms,
         attempt_id = excluded.attempt_id`,
      [leaseExpiresAt, attemptId],
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
      "SELECT status FROM execution_attempts WHERE attempt_id = ?",
      [attemptId],
    );
    expect(cancelled?.status).toBe("cancelled");

    const slot = await db2.get<{ attempt_id: string | null }>(
      "SELECT attempt_id FROM concurrency_slots WHERE scope = 'global' AND scope_id = 'global' AND slot = 0",
    );
    expect(slot?.attempt_id).toBeNull();

    // Next tick executes the recovered step and completes the run.
    for (let i = 0; i < 10; i += 1) {
      const worked = await engine2.workerTick({ workerId: "w2", executor: fastExecutor });
      if (!worked) break;
    }

    const run = await db2.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
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
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [run2.runId],
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
      "SELECT run_id, status FROM execution_runs WHERE run_id IN (?, ?)",
      [run1.runId, run2.runId],
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
    await db.run(
      `INSERT INTO watchers (plan_id, trigger_type, trigger_config, active, created_at, updated_at)
       VALUES ('plan-1', 'periodic', ?, 1, datetime('now'), datetime('now'))`,
      [JSON.stringify({ intervalMs: 1000 })],
    );
    const watcher = await db.get<{ id: number }>("SELECT id FROM watchers WHERE plan_id = 'plan-1' LIMIT 1");
    expect(watcher?.id).toBeTruthy();

    const dal = new WatcherFiringDal(db);
    const nowMs = Date.now();
    const slotMs = Math.floor(nowMs / 1000) * 1000;
    const firingId = `firing-${String(watcher!.id)}-${String(slotMs)}`;
    await dal.createIfAbsent({ firingId, watcherId: watcher!.id, planId: "plan-1", triggerType: "periodic", scheduledAtMs: slotMs });

    // Scheduler A claims and then "crashes" before marking enqueued.
    const claimedA = await dal.claimNext({ owner: "sched-a", nowMs: slotMs, leaseTtlMs: 25 });
    expect(claimedA?.lease_owner).toBe("sched-a");

    // Scheduler B cannot claim until lease expires.
    const blocked = await dal.claimNext({ owner: "sched-b", nowMs: slotMs + 1, leaseTtlMs: 25 });
    expect(blocked).toBeUndefined();

    // After expiry, scheduler B takes over and marks enqueued.
    const claimedB = await dal.claimNext({ owner: "sched-b", nowMs: slotMs + 50, leaseTtlMs: 25 });
    expect(claimedB?.lease_owner).toBe("sched-b");
    expect(await dal.markEnqueued({ firingId, owner: "sched-b" })).toBe(true);

    const row = await dal.getById(firingId);
    expect(row?.status).toBe("enqueued");

    const count = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM watcher_firings WHERE watcher_id = ? AND scheduled_at_ms = ?",
      [watcher!.id, slotMs],
    );
    expect(count?.n).toBe(1);
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
