import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, vi } from "vitest";
import mitt from "mitt";
import { PolicyService } from "@tyrum/runtime-policy";
import type { GatewayEvents } from "../../src/event-bus.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
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
      processor: new WatcherProcessor({ db, eventBus }),
      scheduler: new WatcherScheduler({ db, eventBus, tickMs: 100 }),
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

export function createAutomationScheduler(
  context: WatcherSchedulerContext,
  overrides?: {
    db?: SqlDb;
    engine?: ExecutionEngine;
    policyService?: PolicyService;
  },
): {
  enqueuedInputs: Array<Record<string, unknown>>;
  scheduler: WatcherScheduler;
} {
  const enqueuedInputs: Array<Record<string, unknown>> = [];
  const db = overrides?.db ?? context.db;
  const { eventBus } = context;
  const engine =
    overrides?.engine ??
    ({
      enqueuePlanInTx: async (tx, input) => {
        enqueuedInputs.push(input as unknown as Record<string, unknown>);
        const jobId = randomUUID();
        const turnId = randomUUID();
        await tx.run(
          `INSERT INTO turn_jobs (
             tenant_id,
             job_id,
             agent_id,
             workspace_id,
             conversation_key,
             status,
             trigger_json,
             policy_snapshot_id
           )
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
          [
            DEFAULT_TENANT_ID,
            jobId,
            DEFAULT_AGENT_ID,
            DEFAULT_WORKSPACE_ID,
            input.key,
            "{}",
            input.policySnapshotId ?? null,
          ],
        );
        await tx.run(
          `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
           VALUES (?, ?, ?, ?, 'queued', 1)`,
          [DEFAULT_TENANT_ID, turnId, jobId, input.key],
        );
        return { jobId, turnId };
      },
    } as unknown as ExecutionEngine);
  const policyService =
    overrides?.policyService ??
    new PolicyService({
      snapshotDal: new PolicySnapshotDal(db),
      overrideDal: new PolicyOverrideDal(db),
      configStore: createGatewayConfigStore({ db }),
    });

  const scheduler = new WatcherScheduler({
    db,
    eventBus,
    owner: "scheduler-1",
    firingLeaseTtlMs: 10_000,
    automationEnabled: true,
    engine,
    policyService,
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
