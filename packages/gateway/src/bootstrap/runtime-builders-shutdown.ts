import type { GatewayBootContext, GatewayRuntime } from "./runtime-shared.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import { isSharedStateMode } from "../modules/runtime-state/mode.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunsToStart(
  context: GatewayBootContext,
  turnIds: readonly string[],
  timeoutMs: number,
): Promise<void> {
  if (turnIds.length === 0 || timeoutMs <= 0) return;

  const placeholders = turnIds.map(() => "?").join(", ");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await context.container.db.all<{ turn_id: string; status: string }>(
      `SELECT turn_id AS turn_id, status FROM turns WHERE turn_id IN (${placeholders})`,
      turnIds,
    );
    const statusByRunId = new Map(rows.map((row) => [row.turn_id, row.status]));
    const allStarted = turnIds.every((turnId) => {
      const status = statusByRunId.get(turnId);
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

async function listLifecycleHookTenantIds(context: GatewayBootContext): Promise<readonly string[]> {
  if (!isSharedStateMode(context.deploymentConfig)) {
    return [DEFAULT_TENANT_ID];
  }

  const rows = await context.container.db.all<{ tenant_id: string }>(
    "SELECT tenant_id FROM tenants ORDER BY tenant_id ASC",
  );
  const tenantIds = Array.from(
    new Set(rows.map((row) => row.tenant_id.trim()).filter((tenantId) => tenantId.length > 0)),
  );
  return tenantIds.length > 0 ? tenantIds : [DEFAULT_TENANT_ID];
}

export async function fireGatewayLifecycleHooks(
  context: GatewayBootContext,
  hooksRuntime: {
    fire(input: {
      event: string;
      tenantId: string;
      metadata?: unknown;
    }): Promise<readonly string[]>;
  },
  input: { event: string; metadata?: unknown },
): Promise<readonly string[]> {
  const turnIds: string[] = [];
  for (const tenantId of await listLifecycleHookTenantIds(context)) {
    try {
      turnIds.push(
        ...(await hooksRuntime.fire({
          event: input.event,
          tenantId,
          metadata: input.metadata,
        })),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.logger.warn("hooks.fire_failed", {
        event: input.event,
        tenant_id: tenantId,
        error: message,
      });
    }
  }
  return turnIds;
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
        ? fireGatewayLifecycleHooks(context, runtime.protocol.hooksRuntime, {
            event: "gateway.shutdown",
            metadata: { signal, instance_id: context.instanceId, role: context.role },
          }).catch((err) => {
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
        const turnIds = await shutdownHookRuns;
        if (turnIds.length > 0) {
          const remainingMs = Math.max(0, hardExitDeadlineMs - Date.now() - 250);
          await waitForRunsToStart(context, turnIds, remainingMs);
        }
      } finally {
        runtime.workerLoop.stop();
        await runtime.workerLoop.done;
      }
    })();
    const stopWorkerAndRuntime = (async () => {
      try {
        await stopWorker;
      } finally {
        // Shutdown hooks execute on the worker loop; keep agent resources alive until
        // queued gateway.shutdown turns have had a chance to start, then tear down
        // the execution-related runtime pieces they depend on.
        runtime.protocol.workSignalScheduler?.stop();
        runtime.protocol.approvalEngineActionProcessor?.stop();
        runtime.protocol.guardianReviewProcessor?.stop();
        runtime.edge.outboxPoller?.stop();
        runtime.edge.telegramProcessor?.stop();
        runtime.edge.discordMonitor?.stop();
        runtime.edge.workboardOrchestrator?.stop();
        runtime.edge.workboardDispatcher?.stop();
        runtime.edge.workboardReconciler?.stop();
        runtime.edge.subagentJanitor?.stop();
        context.container.modelsDev.stopBackgroundRefresh();
        const shutdownPluginCatalogProvider = runtime.edge.pluginCatalogProvider
          ? runtime.edge.pluginCatalogProvider.shutdown()
          : Promise.resolve();
        const shutdownAgents = runtime.edge.agents
          ? runtime.edge.agents.shutdown()
          : Promise.resolve();
        const stopDesktopHostRuntime = runtime.desktopHostRuntime
          ? runtime.desktopHostRuntime.stop()
          : Promise.resolve();
        const stopTelegramPollingMonitor = runtime.edge.telegramPollingMonitor
          ? runtime.edge.telegramPollingMonitor.stop()
          : Promise.resolve();
        await Promise.allSettled([
          stopDesktopHostRuntime,
          stopTelegramPollingMonitor,
          runtime.otel.shutdown(),
          shutdownPluginCatalogProvider,
          shutdownAgents,
        ]);
      }
    })();

    const closeWss = closeCallbackTarget(runtime.edge.wsHandler?.wss);

    context.container.watcherProcessor.stop();
    runtime.background.watcherScheduler?.stop();
    runtime.background.artifactLifecycleScheduler?.stop();
    runtime.background.outboxLifecycleScheduler?.stop();
    runtime.background.stateStoreLifecycleScheduler?.stop();

    void runShutdownCleanup([closeServer, closeWss, shutdownHookRuns, stopWorkerAndRuntime], () =>
      context.container.db.close(),
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
