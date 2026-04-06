import { describe, expect, it } from "vitest";

import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { startExecutionWorkerLoop } from "../../src/modules/execution/worker-loop.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { NoCapableNodeError } from "../../src/ws/protocol/errors.js";
import type { ExecutionWorkerEngine } from "@tyrum/runtime-execution";

import {
  createAllOnceFailingAllDb,
  createPeriodicWatcherFiring,
  createRestartingOutboxDal,
  createSuccessExecutor,
  dispatchCliTaskForRun,
  expectSingleCapabilityEdge,
  expectTaskExecuteRun,
  insertPeriodicWatcher,
  issueTenantAdminToken,
  useFailureMatrixResources,
} from "./failure-matrix.fixtures.js";
import { delay } from "./failure-matrix.test-support.js";

describe("Failure matrix (scaling-ha)", () => {
  const connectionsTtlMs = 50;
  const resources = useFailureMatrixResources();

  it("routes ws.direct across edges and cleans up stale connection directory entries after edge failure", async () => {
    const dbPath = await resources.createDbPath("tyrum-failure-matrix-ws-");
    const [dbA, dbB] = resources.openDbs(dbPath, 2);

    const authTokensA = new AuthTokenService(dbA);
    const authTokensB = new AuthTokenService(dbB);
    const token = await issueTenantAdminToken(authTokensA);

    const edgeA = await resources.startClusterEdge({
      edgeId: "edge-a",
      db: dbA,
      authTokens: authTokensA,
      connectionTtlMs: connectionsTtlMs,
    });
    const edgeB = await resources.startClusterEdge({
      edgeId: "edge-b",
      db: dbB,
      authTokens: authTokensB,
      connectionTtlMs: connectionsTtlMs,
    });

    const { ws: clientA } = await resources.connectClient({
      port: edgeA.port,
      token,
      role: "node",
      capabilities: ["desktop"],
    });

    await expectSingleCapabilityEdge(edgeA.connectionDirectory, "edge-a");

    const taskScopeX = await dispatchCliTaskForRun(edgeB, "550e8400-e29b-41d4-a716-446655440000");
    await edgeA.outboxPoller.tick();
    await expectTaskExecuteRun(clientA, taskScopeX.turnId, "task.execute");

    edgeA.wsHandler.stopHeartbeat();
    await delay(connectionsTtlMs + 25);
    expect(await edgeB.connectionDirectory.cleanupExpired(Date.now())).toBe(1);

    await expect(
      dispatchCliTaskForRun(edgeB, "550e8400-e29b-41d4-a716-446655440001"),
    ).rejects.toBeInstanceOf(NoCapableNodeError);

    clientA.close();

    const { ws: clientB } = await resources.connectClient({
      port: edgeB.port,
      token,
      role: "node",
      capabilities: ["desktop"],
    });

    await expectSingleCapabilityEdge(edgeB.connectionDirectory, "edge-b");

    const taskScopeZ = await dispatchCliTaskForRun(edgeA, "550e8400-e29b-41d4-a716-446655440002");
    await edgeB.outboxPoller.tick();
    await expectTaskExecuteRun(clientB, taskScopeZ.turnId, "task.execute edge-b");
  });

  it("recovers ws.direct routing after edge crash+restart (client reconnects; directory + outbox resume)", async () => {
    const dbPath = await resources.createDbPath("tyrum-failure-matrix-edge-restart-");
    const [dbA1, dbB] = resources.openDbs(dbPath, 2);

    const authTokensA1 = new AuthTokenService(dbA1);
    const authTokensB = new AuthTokenService(dbB);
    const token = await issueTenantAdminToken(authTokensA1);

    const edgeA1 = await resources.startClusterEdge({
      edgeId: "edge-a",
      db: dbA1,
      authTokens: authTokensA1,
      connectionTtlMs: connectionsTtlMs,
    });
    const edgeB = await resources.startClusterEdge({
      edgeId: "edge-b",
      db: dbB,
      authTokens: authTokensB,
      connectionTtlMs: connectionsTtlMs,
    });

    const { ws: clientA1 } = await resources.connectClient({
      port: edgeA1.port,
      token,
      role: "node",
      capabilities: ["desktop"],
    });

    await expectSingleCapabilityEdge(edgeA1.connectionDirectory, "edge-a");

    const taskScope1 = await dispatchCliTaskForRun(edgeB, "550e8400-e29b-41d4-a716-446655440010");
    await edgeA1.outboxPoller.tick();
    await expectTaskExecuteRun(clientA1, taskScope1.turnId, "task.execute (pre-restart)");

    edgeA1.wsHandler.stopHeartbeat();
    await delay(connectionsTtlMs + 25);
    expect(await edgeB.connectionDirectory.cleanupExpired(Date.now())).toBe(1);

    await expect(
      dispatchCliTaskForRun(edgeB, "550e8400-e29b-41d4-a716-446655440012"),
    ).rejects.toBeInstanceOf(NoCapableNodeError);

    clientA1.close();

    const dbA2 = resources.openDb(dbPath);
    const authTokensA2 = new AuthTokenService(dbA2);
    const edgeA2 = await resources.startClusterEdge({
      edgeId: "edge-a",
      db: dbA2,
      authTokens: authTokensA2,
      connectionTtlMs: connectionsTtlMs,
    });

    const { ws: clientA2 } = await resources.connectClient({
      port: edgeA2.port,
      token,
      role: "node",
      capabilities: ["desktop"],
    });

    await expectSingleCapabilityEdge(edgeA2.connectionDirectory, "edge-a");

    const taskScope2 = await dispatchCliTaskForRun(edgeB, "550e8400-e29b-41d4-a716-446655440011");
    await edgeA2.outboxPoller.tick();
    await expectTaskExecuteRun(clientA2, taskScope2.turnId, "task.execute (post-restart)");
  });

  it("transfers scheduler work after crash via firing leases (no double-fires)", async () => {
    const dbPath = await resources.createDbPath("tyrum-failure-matrix-scheduler-");
    const db = resources.openDb(dbPath);

    const { dal, watcherId, watcherFiringId, scheduledAtMs } =
      await createPeriodicWatcherFiring(db);

    const claimedA = await dal.claimNext({
      owner: "sched-a",
      nowMs: scheduledAtMs,
      leaseTtlMs: 25,
    });
    expect(claimedA?.lease_owner).toBe("sched-a");

    const blocked = await dal.claimNext({
      owner: "sched-b",
      nowMs: scheduledAtMs + 1,
      leaseTtlMs: 25,
    });
    expect(blocked).toBeUndefined();

    const claimedB = await dal.claimNext({
      owner: "sched-b",
      nowMs: scheduledAtMs + 50,
      leaseTtlMs: 25,
    });
    expect(claimedB?.lease_owner).toBe("sched-b");
    expect(
      await dal.markEnqueued({
        tenantId: DEFAULT_TENANT_ID,
        watcherFiringId,
        owner: "sched-b",
      }),
    ).toBe(true);

    const row = await dal.getById({ tenantId: DEFAULT_TENANT_ID, watcherFiringId });
    expect(row?.status).toBe("enqueued");

    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM watcher_firings
       WHERE tenant_id = ? AND watcher_id = ? AND scheduled_at_ms = ?`,
      [DEFAULT_TENANT_ID, watcherId, scheduledAtMs],
    );
    expect(count?.n).toBe(1);
  });

  it("tolerates transient DB failures in watcher scheduler interval (scheduler↔DB partition)", async () => {
    const dbPath = await resources.createDbPath("tyrum-failure-matrix-scheduler-db-partition-");
    const db = resources.openDb(dbPath);

    await insertPeriodicWatcher(db);

    const flakyDb = createAllOnceFailingAllDb(db);
    const scheduler = new WatcherScheduler({
      db: flakyDb.db,
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
      expect(flakyDb.getAllCalls()).toBeGreaterThan(0);
      expect(enqueued).toBe(true);
    } finally {
      scheduler.stop();
    }
  });

  it("replays ws.direct outbox rows after DB restart between poll and ack (at-least-once)", async () => {
    const dbPath = await resources.createDbPath("tyrum-failure-matrix-db-restart-outbox-");
    const db1 = resources.openDb(dbPath);

    const authTokens = new AuthTokenService(db1);
    const token = await issueTenantAdminToken(authTokens);

    const connectionManager = new ConnectionManager();
    const { port } = await resources.startWsGateway({ connectionManager, authTokens });

    const { ws, connectionId } = await resources.connectClient({
      port,
      token,
      role: "client",
      capabilities: ["desktop"],
    });

    const consumerId = "edge-db-restart";
    const outboxDal1 = new OutboxDal(db1);
    await outboxDal1.ensureConsumer(DEFAULT_TENANT_ID, consumerId);

    const turnId = "550e8400-e29b-41d4-a716-446655440020";
    const row = await outboxDal1.enqueue(
      DEFAULT_TENANT_ID,
      "ws.direct",
      {
        connection_id: connectionId,
        message: {
          request_id: "task-db-restart",
          type: "task.execute",
          payload: {
            turn_id: turnId,
            dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
            action: { type: "Desktop", args: { op: "screenshot" } },
          },
        },
      },
      { targetEdgeId: consumerId },
    );

    const restartingOutbox = createRestartingOutboxDal(resources, {
      dbPath,
      db: db1,
      outboxDal: outboxDal1,
    });
    const poller = new OutboxPoller({
      consumerId,
      outboxDal: restartingOutbox.outboxDal,
      connectionManager,
    });

    const firstMessage = expectTaskExecuteRun(ws, turnId, "task.execute (first)");
    await poller.tick();
    await firstMessage;

    const replayMessage = expectTaskExecuteRun(ws, turnId, "task.execute (replay)");
    await poller.tick();
    await replayMessage;

    const cursor = await restartingOutbox.getCurrentDb().get<{
      last_outbox_id: number;
    }>("SELECT last_outbox_id FROM outbox_consumers WHERE tenant_id = ? AND consumer_id = ?", [DEFAULT_TENANT_ID, consumerId]);
    expect(cursor?.last_outbox_id).toBe(row.id);
  });

  it("tolerates transient DB failures in outbox polling (edge↔DB partition)", async () => {
    const connectionManager = new ConnectionManager();
    const poller = new OutboxPoller({
      consumerId: "edge-x",
      outboxDal: {
        listActiveTenantIds: async () => [DEFAULT_TENANT_ID],
        poll: async () => {
          throw new Error("db down");
        },
        ackConsumerCursor: async () => undefined,
        ensureConsumer: async () => undefined,
      } as unknown as OutboxDal,
      connectionManager,
    });

    await poller.tick();
  });

  it("tolerates transient DB failures in worker loop (worker↔DB partition)", async () => {
    let ticks = 0;
    const loop = startExecutionWorkerLoop({
      engine: {
        workerTick: async () => {
          ticks += 1;
          throw new Error("db down");
        },
      } as ExecutionWorkerEngine,
      workerId: "w-db-partition",
      executor: createSuccessExecutor(),
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
