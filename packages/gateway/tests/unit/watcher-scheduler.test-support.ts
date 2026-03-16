import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, vi } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";
import mitt from "mitt";
import type { GatewayEvents } from "../../src/event-bus.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

export type WatcherSchedulerContext = {
  db: SqliteDb;
  memoryDal: MemoryDal;
  eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  processor: WatcherProcessor;
  scheduler: WatcherScheduler;
};

export type WatcherSchedulerState = {
  current: WatcherSchedulerContext | undefined;
};

export function registerWatcherSchedulerLifecycle(): WatcherSchedulerState {
  const state: WatcherSchedulerState = { current: undefined };

  beforeEach(() => {
    const db = openTestSqliteDb();
    const memoryDal = new MemoryDal(db);
    const eventBus = mitt<GatewayEvents>();

    state.current = {
      db,
      memoryDal,
      eventBus,
      processor: new WatcherProcessor({ db, memoryDal, eventBus }),
      scheduler: new WatcherScheduler({ db, memoryDal, eventBus, tickMs: 100 }),
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!state.current) return;

    await state.current.db.close();
    state.current = undefined;
  });

  return state;
}

export function requireWatcherSchedulerContext(
  state: WatcherSchedulerState,
): WatcherSchedulerContext {
  if (!state.current) {
    throw new Error("WatcherScheduler test context not initialized");
  }

  return state.current;
}

export function createAutomationScheduler(context: WatcherSchedulerContext): {
  enqueuedInputs: Array<Record<string, unknown>>;
  scheduler: WatcherScheduler;
} {
  const enqueuedInputs: Array<Record<string, unknown>> = [];
  const policyBundle = PolicyBundle.parse({ v: 1 });
  const { db, eventBus, memoryDal } = context;

  const scheduler = new WatcherScheduler({
    db,
    memoryDal,
    eventBus,
    owner: "scheduler-1",
    firingLeaseTtlMs: 10_000,
    automationEnabled: true,
    engine: {
      enqueuePlanInTx: async (tx, input) => {
        enqueuedInputs.push(input as unknown as Record<string, unknown>);
        const jobId = randomUUID();
        const runId = randomUUID();
        await tx.run(
          `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
          [
            DEFAULT_TENANT_ID,
            jobId,
            DEFAULT_AGENT_ID,
            DEFAULT_WORKSPACE_ID,
            input.key,
            input.lane,
            "{}",
          ],
        );
        await tx.run(
          `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
           VALUES (?, ?, ?, ?, ?, 'queued', 1)`,
          [DEFAULT_TENANT_ID, runId, jobId, input.key, input.lane],
        );
        return { jobId, runId };
      },
    } as unknown as ExecutionEngine,
    policyService: {
      loadEffectiveBundle: async () => ({
        bundle: policyBundle,
        sha256: "sha256",
        sources: { deployment: "default", agent: null, playbook: null },
      }),
      getOrCreateSnapshot: async () => ({
        policy_snapshot_id: "snapshot-1",
        sha256: "sha256",
        created_at: new Date().toISOString(),
        bundle: policyBundle,
      }),
    } as unknown as PolicyService,
  });

  return { enqueuedInputs, scheduler };
}

export async function withAutomationEnabledEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env["TYRUM_AUTOMATION_ENABLED"];
  process.env["TYRUM_AUTOMATION_ENABLED"] = "1";

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env["TYRUM_AUTOMATION_ENABLED"];
    } else {
      process.env["TYRUM_AUTOMATION_ENABLED"] = previous;
    }
  }
}
