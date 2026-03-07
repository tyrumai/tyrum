import { ScheduleService } from "../modules/automation/schedule-service.js";
import { ArtifactLifecycleScheduler } from "../modules/artifact/lifecycle.js";
import { OutboxLifecycleScheduler } from "../modules/backplane/outbox-lifecycle.js";
import { loadAllPlaybooks } from "../modules/playbook/loader.js";
import { PlaybookRunner } from "../modules/playbook/runner.js";
import { gatewayMetrics } from "../modules/observability/metrics.js";
import { StateStoreLifecycleScheduler } from "../modules/statestore/lifecycle.js";
import { WatcherScheduler } from "../modules/watcher/scheduler.js";
import type { BackgroundSchedulers, GatewayBootContext } from "./runtime-shared.js";
import { createExecutionEngine } from "./runtime-builders-engine.js";

export async function startBackgroundSchedulers(
  context: GatewayBootContext,
): Promise<BackgroundSchedulers> {
  const keepProcessAlive = context.role === "scheduler";
  const shouldRunScheduler = context.role === "all" || context.role === "scheduler";
  const automationEnabled = context.deploymentConfig.automation.enabled;
  const schedulerEngine =
    shouldRunScheduler && automationEnabled ? createExecutionEngine(context) : undefined;

  if (shouldRunScheduler && automationEnabled) {
    const scheduleService = new ScheduleService(
      context.container.db,
      context.container.identityScopeDal,
    );
    const seeded = await scheduleService.seedDefaultHeartbeatSchedules();
    if (seeded > 0) {
      context.logger.info("automation.default_heartbeat_seeded", { count: seeded });
    }
  }

  const watcherScheduler = shouldRunScheduler
    ? (() => {
        const playbookHome = context.container.config?.tyrumHome;
        const playbooks = playbookHome ? loadAllPlaybooks(`${playbookHome}/playbooks`) : [];
        const playbookRunner = new PlaybookRunner();

        return new WatcherScheduler({
          db: context.container.db,
          memoryV1Dal: context.container.memoryV1Dal,
          eventBus: context.container.eventBus,
          logger: context.logger,
          engine: schedulerEngine,
          policyService: context.container.policyService,
          playbooks,
          playbookRunner,
          automationEnabled,
          keepProcessAlive,
        });
      })()
    : undefined;
  const artifactLifecycleScheduler = shouldRunScheduler
    ? new ArtifactLifecycleScheduler({
        db: context.container.db,
        artifactStore: context.container.artifactStore,
        policySnapshotDal: context.container.policySnapshotDal,
        keepProcessAlive,
        logger: context.container.logger,
      })
    : undefined;
  const outboxLifecycleScheduler = shouldRunScheduler
    ? new OutboxLifecycleScheduler({
        db: context.container.db,
        keepProcessAlive,
        logger: context.container.logger,
        metrics: gatewayMetrics,
      })
    : undefined;
  const stateStoreLifecycleScheduler = shouldRunScheduler
    ? new StateStoreLifecycleScheduler({
        db: context.container.db,
        channelTerminalRetentionDays:
          context.deploymentConfig.lifecycle.channels.terminalRetentionDays,
        keepProcessAlive,
        logger: context.container.logger,
        metrics: gatewayMetrics,
        sessionsTtlDays: context.deploymentConfig.lifecycle.sessions.ttlDays,
      })
    : undefined;

  if (context.shouldRunEdge) context.container.watcherProcessor.start();
  watcherScheduler?.start();
  artifactLifecycleScheduler?.start();
  outboxLifecycleScheduler?.start();
  stateStoreLifecycleScheduler?.start();
  return {
    watcherScheduler,
    artifactLifecycleScheduler,
    outboxLifecycleScheduler,
    stateStoreLifecycleScheduler,
  };
}
