import { afterEach, expect } from "vitest";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { ConnectionDirectoryDal } from "../../src/modules/backplane/connection-directory.js";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { WatcherFiringDal } from "../../src/modules/watcher/firing-dal.js";
import { createWsHandler } from "../../src/routes/ws.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask } from "../../src/ws/protocol.js";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";

import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  connectClientWithProof,
  listen,
  waitForJsonMessageMatching,
} from "./failure-matrix.test-support.js";

const DEFAULT_STEP_ID = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
const DEFAULT_ATTEMPT_ID = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";

export const approvedCliPairingDal = {
  getByNodeId: async () =>
    ({
      status: "approved",
      capability_allowlist: [
        {
          id: "tyrum.desktop.screenshot",
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    }) as never,
} as never;

export interface ClusterEdgeHandle {
  edgeId: string;
  connectionManager: ConnectionManager;
  connectionDirectory: ConnectionDirectoryDal;
  outboxDal: OutboxDal;
  outboxPoller: OutboxPoller;
  wsHandler: ReturnType<typeof createWsHandler>;
  port: number;
}

export interface FailureMatrixResources {
  createDbPath(prefix: string): Promise<string>;
  openDb(dbPath: string): SqliteDb;
  openDbs(dbPath: string, count: number): SqliteDb[];
  restartDb(db: SqliteDb, dbPath: string): Promise<SqliteDb>;
  startClusterEdge(input: {
    edgeId: string;
    db: SqliteDb;
    authTokens: AuthTokenService;
    connectionTtlMs: number;
  }): Promise<ClusterEdgeHandle>;
  startWsGateway(input: {
    connectionManager: ConnectionManager;
    authTokens: AuthTokenService;
  }): Promise<{ port: number }>;
  connectClient(
    input: Parameters<typeof connectClientWithProof>[0],
  ): ReturnType<typeof connectClientWithProof>;
}

export function useFailureMatrixResources(): FailureMatrixResources {
  let dirs: string[] = [];
  let dbs: SqliteDb[] = [];
  let servers: Server[] = [];
  let heartbeats: Array<() => void> = [];
  let sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
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

  const trackDb = (db: SqliteDb) => {
    dbs.push(db);
    return db;
  };

  return {
    async createDbPath(prefix) {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      dirs.push(dir);
      return join(dir, "gateway.db");
    },
    openDb(dbPath) {
      return trackDb(openTestSqliteDb(dbPath));
    },
    openDbs(dbPath, count) {
      return Array.from({ length: count }, () => trackDb(openTestSqliteDb(dbPath)));
    },
    async restartDb(db, dbPath) {
      await db.close();
      dbs = dbs.filter((candidate) => candidate !== db);
      return trackDb(openTestSqliteDb(dbPath));
    },
    async startClusterEdge({ edgeId, db, authTokens, connectionTtlMs }) {
      const connectionManager = new ConnectionManager();
      const connectionDirectory = new ConnectionDirectoryDal(db);
      const outboxDal = new OutboxDal(db);
      const outboxPoller = new OutboxPoller({ consumerId: edgeId, outboxDal, connectionManager });
      await outboxDal.ensureConsumer(DEFAULT_TENANT_ID, edgeId);

      const wsHandler = createWsHandler({
        connectionManager,
        protocolDeps: { connectionManager },
        authTokens,
        cluster: { instanceId: edgeId, connectionDirectory, connectionTtlMs },
      });
      heartbeats.push(wsHandler.stopHeartbeat);

      const { server, port } = await listen(wsHandler);
      servers.push(server);

      return {
        edgeId,
        connectionManager,
        connectionDirectory,
        outboxDal,
        outboxPoller,
        wsHandler,
        port,
      };
    },
    async startWsGateway({ connectionManager, authTokens }) {
      const wsHandler = createWsHandler({
        connectionManager,
        protocolDeps: { connectionManager },
        authTokens,
      });
      heartbeats.push(wsHandler.stopHeartbeat);

      const { server, port } = await listen(wsHandler);
      servers.push(server);
      return { port };
    },
    async connectClient(input) {
      const connection = await connectClientWithProof(input);
      sockets.push(connection.ws);
      return connection;
    },
  };
}

export async function issueTenantAdminToken(authTokens: AuthTokenService): Promise<string> {
  return (
    await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
  ).token;
}

export async function expectSingleCapabilityEdge(
  connectionDirectory: ConnectionDirectoryDal,
  edgeId: string,
): Promise<void> {
  const list = await connectionDirectory.listConnectionsForCapability(
    DEFAULT_TENANT_ID,
    "tyrum.desktop.screenshot",
    Date.now(),
  );
  expect(list.length).toBe(1);
  expect(list[0]!.edge_id).toBe(edgeId);
}

export async function dispatchCliTaskForRun(
  edge: Pick<
    ClusterEdgeHandle,
    "edgeId" | "connectionManager" | "outboxDal" | "connectionDirectory"
  >,
  runId: string,
): Promise<{ tenantId: string; runId: string; stepId: string; attemptId: string }> {
  const taskScope = {
    tenantId: DEFAULT_TENANT_ID,
    runId,
    stepId: DEFAULT_STEP_ID,
    attemptId: DEFAULT_ATTEMPT_ID,
  };
  await dispatchTask({ type: "Desktop", args: { op: "screenshot" } }, taskScope, {
    connectionManager: edge.connectionManager,
    nodePairingDal: approvedCliPairingDal,
    cluster: {
      edgeId: edge.edgeId,
      outboxDal: edge.outboxDal,
      connectionDirectory: edge.connectionDirectory,
    },
  } as never);
  return taskScope;
}

export async function expectTaskExecuteRun(
  ws: WebSocket,
  runId: string,
  label: string,
): Promise<void> {
  const message = await waitForJsonMessageMatching(
    ws,
    (candidate) =>
      candidate["type"] === "task.execute" &&
      (candidate["payload"] as Record<string, unknown>)["turn_id"] === runId,
    5_000,
    label,
  );
  expect((message["payload"] as Record<string, unknown>)["turn_id"]).toBe(runId);
}

export function createSuccessExecutor(): StepExecutor {
  return {
    execute: async (): Promise<StepResult> => ({ success: true, result: { ok: true } }),
  };
}

export async function getRequiredStepId(db: SqliteDb, runId: string): Promise<string> {
  const step = await db.get<{ step_id: string }>(
    "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ?",
    [DEFAULT_TENANT_ID, runId],
  );
  expect(step?.step_id).toBeTruthy();
  return step!.step_id;
}

export async function seedDeadWorkerAttempt(input: {
  db: SqliteDb;
  stepId: string;
  nowMs: number;
  attemptId: string;
  leaseTtlMs?: number;
}): Promise<void> {
  const leaseExpiresAt = input.nowMs + (input.leaseTtlMs ?? 25);

  await input.db.run(
    "UPDATE execution_steps SET status = 'running' WHERE tenant_id = ? AND step_id = ?",
    [DEFAULT_TENANT_ID, input.stepId],
  );
  await input.db.run(
    `INSERT INTO execution_attempts (
       tenant_id, attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms
     ) VALUES (?, ?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
    [
      DEFAULT_TENANT_ID,
      input.attemptId,
      input.stepId,
      new Date(input.nowMs).toISOString(),
      leaseExpiresAt,
    ],
  );
  await input.db.run(
    `INSERT INTO concurrency_slots (
       tenant_id, scope, scope_id, slot, lease_owner, lease_expires_at_ms, attempt_id
     )
     VALUES (?, 'global', 'global', 0, 'dead-worker', ?, ?)
     ON CONFLICT (tenant_id, scope, scope_id, slot) DO UPDATE SET
       lease_owner = excluded.lease_owner,
       lease_expires_at_ms = excluded.lease_expires_at_ms,
       attempt_id = excluded.attempt_id`,
    [DEFAULT_TENANT_ID, leaseExpiresAt, input.attemptId],
  );
}

export async function insertPeriodicWatcher(db: SqliteDb, planId = "plan-1"): Promise<string> {
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
      JSON.stringify({ intervalMs: 1000, planId }),
    ],
  );
  return watcherId;
}

export async function createPeriodicWatcherFiring(db: SqliteDb): Promise<{
  dal: WatcherFiringDal;
  watcherId: string;
  watcherFiringId: string;
  scheduledAtMs: number;
}> {
  const watcherId = await insertPeriodicWatcher(db);
  const dal = new WatcherFiringDal(db);
  const scheduledAtMs = Math.floor(Date.now() / 1000) * 1000;
  const watcherFiringId = randomUUID();

  await dal.createIfAbsent({
    tenantId: DEFAULT_TENANT_ID,
    watcherFiringId,
    watcherId,
    scheduledAtMs,
  });

  return { dal, watcherId, watcherFiringId, scheduledAtMs };
}

export function createAllOnceFailingAllDb(db: SqliteDb): {
  db: SqliteDb;
  getAllCalls(): number;
} {
  let allCalls = 0;
  let failAllOnce = true;

  return {
    db: {
      kind: "sqlite",
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
    } as SqliteDb,
    getAllCalls: () => allCalls,
  };
}

export function createRestartingOutboxDal(
  resources: FailureMatrixResources,
  input: { dbPath: string; db: SqliteDb; outboxDal: OutboxDal },
): { outboxDal: OutboxDal; getCurrentDb(): SqliteDb } {
  let currentDb = input.db;
  let currentOutboxDal: OutboxDal | undefined;
  let didRestart = false;
  let didFailAck = false;

  return {
    outboxDal: {
      listActiveTenantIds: async () => [DEFAULT_TENANT_ID],
      poll: async (tenantId: string, consumerKey: string, batchSize?: number) => {
        if (didRestart) {
          return await currentOutboxDal!.poll(tenantId, consumerKey, batchSize);
        }

        const rows = await input.outboxDal.poll(tenantId, consumerKey, batchSize);
        currentDb = await resources.restartDb(input.db, input.dbPath);
        currentOutboxDal = new OutboxDal(currentDb);
        didRestart = true;
        return rows;
      },
      ackConsumerCursor: async (tenantId: string, consumerKey: string, lastOutboxId: number) => {
        if (didRestart && !didFailAck) {
          didFailAck = true;
          return await input.outboxDal.ackConsumerCursor(tenantId, consumerKey, lastOutboxId);
        }
        return await currentOutboxDal!.ackConsumerCursor(tenantId, consumerKey, lastOutboxId);
      },
      ensureConsumer: async (tenantId: string, consumerKey: string) => {
        if (didRestart) {
          await currentOutboxDal!.ensureConsumer(tenantId, consumerKey);
          return;
        }
        await input.outboxDal.ensureConsumer(tenantId, consumerKey);
      },
    } as unknown as OutboxDal,
    getCurrentDb: () => currentDb,
  };
}
