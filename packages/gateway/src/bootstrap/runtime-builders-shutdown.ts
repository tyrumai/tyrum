import type { GatewayBootContext, GatewayRuntime } from "./runtime-shared.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunsToStart(
  context: GatewayBootContext,
  runIds: readonly string[],
  timeoutMs: number,
): Promise<void> {
  if (runIds.length === 0 || timeoutMs <= 0) return;

  const placeholders = runIds.map(() => "?").join(", ");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await context.container.db.all<{ run_id: string; status: string }>(
      `SELECT run_id, status FROM execution_runs WHERE run_id IN (${placeholders})`,
      runIds,
    );
    const statusByRunId = new Map(rows.map((row) => [row.run_id, row.status]));
    const allStarted = runIds.every((runId) => {
      const status = statusByRunId.get(runId);
      return status !== undefined && status !== "queued";
    });
    if (allStarted) return;
    await sleep(50);
  }
}

function closeCallbackTarget(
  closeable: { close(callback: () => void): void } | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!closeable) return resolve();
      closeable.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function createShutdownHandler(
  context: GatewayBootContext,
  runtime: GatewayRuntime,
): (signal: string) => void {
  let shuttingDown = false;

  return (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Gateway shutting down (${signal})`);
    const shutdownStartedAtMs = Date.now();
    const hardExitTimeoutMs = 15_000;
    const hardExitDeadlineMs = shutdownStartedAtMs + hardExitTimeoutMs;

    const hardExitTimer = setTimeout(() => {
      console.warn("Gateway forced shutdown after 15 seconds.");
      process.exit(1);
    }, hardExitTimeoutMs);
    hardExitTimer.unref();

    const closeServer = closeCallbackTarget(runtime.edge.server);

    runtime.edge.wsHandler?.stopHeartbeat();
    runtime.edge.authRateLimiter?.stop();
    runtime.edge.wsUpgradeRateLimiter?.stop();

    const shutdownHookRuns =
      runtime.protocol.hooksRuntime && context.shouldRunWorker
        ? runtime.protocol.hooksRuntime
            .fire({
              event: "gateway.shutdown",
              tenantId: DEFAULT_TENANT_ID,
              metadata: { signal, instance_id: context.instanceId, role: context.role },
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              context.logger.warn("hooks.fire_failed", {
                event: "gateway.shutdown",
                error: message,
              });
              return [];
            })
        : Promise.resolve([]);

    const stopWorker = (async () => {
      if (!runtime.workerLoop) return;
      try {
        const runIds = await shutdownHookRuns;
        if (runIds.length > 0) {
          const remainingMs = Math.max(0, hardExitDeadlineMs - Date.now() - 250);
          await waitForRunsToStart(context, runIds, remainingMs);
        }
      } finally {
        runtime.workerLoop.stop();
        await runtime.workerLoop.done;
      }
    })();

    const closeWss = closeCallbackTarget(runtime.edge.wsHandler?.wss);

    context.container.watcherProcessor.stop();
    runtime.background.watcherScheduler?.stop();
    runtime.background.artifactLifecycleScheduler?.stop();
    runtime.background.outboxLifecycleScheduler?.stop();
    runtime.background.stateStoreLifecycleScheduler?.stop();
    runtime.protocol.workSignalScheduler?.stop();
    runtime.protocol.approvalEngineActionProcessor?.stop();
    runtime.edge.outboxPoller?.stop();
    runtime.edge.telegramProcessor?.stop();
    context.container.modelsDev.stopBackgroundRefresh();

    void runShutdownCleanup(
      [
        closeServer,
        closeWss,
        shutdownHookRuns,
        runtime.edge.agents?.shutdown() ?? Promise.resolve(),
        runtime.otel.shutdown(),
        stopWorker,
      ],
      () => context.container.db.close(),
    ).finally(() => {
      clearTimeout(hardExitTimer);
      process.exit(0);
    });
  };
}

export async function runShutdownCleanup(
  cleanupTasks: readonly Promise<unknown>[],
  closeDb: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled(cleanupTasks);
  await Promise.allSettled([closeDb()]);
}
