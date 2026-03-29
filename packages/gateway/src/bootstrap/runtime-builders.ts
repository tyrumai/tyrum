import { createApp } from "../app.js";
import { AgentRegistry } from "../modules/agent/registry.js";
import { AuthAudit } from "../modules/auth/audit.js";
import { SlidingWindowRateLimiter } from "../modules/auth/rate-limiter.js";
import { ApprovalEngineActionProcessor } from "../modules/approval/engine-action-processor.js";
import { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { DesktopEnvironmentDal } from "../modules/desktop-environments/dal.js";
import { OutboxDal } from "../modules/backplane/outbox-dal.js";
import { OutboxPoller } from "../modules/backplane/outbox-poller.js";
import {
  startExecutionWorkerLoop,
  type ExecutionWorkerLoop,
} from "../modules/execution/worker-loop.js";
import { LifecycleHooksRuntime } from "../modules/hooks/runtime.js";
import { LocationService } from "../modules/location/service.js";
import type { OtelRuntime } from "../modules/observability/otel.js";
import { createPluginCatalogProvider } from "../modules/plugins/catalog-provider.js";
import { GuardianReviewProcessor } from "../modules/review/guardian-review-processor.js";
import { loadAllPlaybooks } from "../modules/playbook/loader.js";
import { PlaybookRunner } from "../modules/playbook/runner.js";
import { WsEventDal } from "../modules/ws-event/dal.js";
import { WorkboardDispatcher } from "../modules/workboard/dispatcher.js";
import { WorkboardOrchestrator } from "../modules/workboard/orchestrator.js";
import { WorkboardReconciler } from "../modules/workboard/reconciler.js";
import { WorkSignalScheduler } from "../modules/workboard/signal-scheduler.js";
import { SubagentJanitor } from "../modules/workboard/subagent-janitor.js";
import { createWsHandler } from "../routes/ws.js";
import { VERSION } from "../version.js";
import { ConnectionManager } from "../ws/connection-manager.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import { TaskResultRegistry, type TaskResult } from "../ws/protocol/task-result-registry.js";
import { startChannelRuntimeBundle } from "./runtime-builders-channels.js";
import { createExecutionEngine } from "./runtime-builders-engine.js";
import { createGatewayServer } from "./runtime-builders-server.js";
import { fireGatewayLifecycleHooks } from "./runtime-builders-shutdown.js";
import {
  createWorkerExecutionEngine,
  createWorkerExecutionExecutor,
} from "./runtime-builders-worker.js";
import type { EdgeRuntime, GatewayBootContext, ProtocolRuntime } from "./runtime-shared.js";
export { startBackgroundSchedulers } from "./runtime-builders-background.js";
export { createShutdownHandler, runShutdownCleanup } from "./runtime-builders-shutdown.js";

function toTaskResult(
  success: boolean,
  result: unknown,
  evidence: unknown,
  error: string | undefined,
): TaskResult {
  if (success) {
    const taskResult: TaskResult = { ok: true };
    if (result !== undefined) taskResult.result = result;
    if (evidence !== undefined) taskResult.evidence = evidence;
    return taskResult;
  }

  const taskResult: TaskResult = { ok: false, error: error ?? "task failed" };
  if (result !== undefined) taskResult.result = result;
  if (evidence !== undefined) taskResult.evidence = evidence;
  return taskResult;
}

export async function createProtocolRuntime(
  context: GatewayBootContext,
  otel: OtelRuntime,
): Promise<ProtocolRuntime> {
  const wsMaxBufferedBytes = context.deploymentConfig.websocket.maxBufferedBytes;
  const connectionManager = new ConnectionManager();
  const outboxDal = new OutboxDal(context.container.db, context.container.redactionEngine);
  const connectionDirectory = new ConnectionDirectoryDal(context.container.db);
  const workSignalScheduler =
    context.role === "all" || context.role === "scheduler"
      ? new WorkSignalScheduler({
          db: context.container.db,
          connectionManager,
          owner: context.instanceId,
          logger: context.logger,
          maxBufferedBytes: wsMaxBufferedBytes,
          cluster: { edgeId: context.instanceId, outboxDal },
          keepProcessAlive: context.role === "scheduler",
        })
      : undefined;
  workSignalScheduler?.start();

  const wsEngine = context.shouldRunEdge ? createExecutionEngine(context) : undefined;
  const edgeEngine = context.deploymentConfig.execution.engineApiEnabled ? wsEngine : undefined;
  const approvalEngine =
    context.shouldRunEdge || context.shouldRunWorker
      ? (edgeEngine ?? createExecutionEngine(context, { includeSecrets: false }))
      : undefined;
  const shouldEnableHooksRuntime =
    context.shouldRunEdge || context.shouldRunWorker
      ? Boolean(context.container.gatewayConfigStore)
      : false;
  const hooksRuntime = shouldEnableHooksRuntime
    ? new LifecycleHooksRuntime({
        db: context.container.db,
        engine: approvalEngine!,
        policyService: context.container.policyService,
        configStore: context.container.gatewayConfigStore,
      })
    : undefined;

  const taskResults = new TaskResultRegistry();
  const wsEventDal = new WsEventDal(context.container.db);
  const desktopEnvironmentDal = new DesktopEnvironmentDal(context.container.db);
  const playbookHome = context.container.config?.tyrumHome;
  const playbooks = playbookHome ? loadAllPlaybooks(`${playbookHome}/playbooks`) : [];
  const protocolDeps: ProtocolDeps = {
    connectionManager,
    logger: context.logger,
    db: context.container.db,
    wsEventDal,
    artifactStore: context.container.artifactStore,
    artifactMaxUploadBytes: context.container.deploymentConfig.attachments.maxUploadBytes,
    redactionEngine: context.container.redactionEngine,
    authAudit: new AuthAudit({ eventLog: context.container.eventLog, logger: context.logger }),
    contextReportDal: context.container.contextReportDal,
    runtime: {
      version: VERSION,
      instanceId: context.instanceId,
      role: context.role,
      dbKind: context.container.db.kind,
      isExposed: !context.isLocalOnly,
      otelEnabled: otel.enabled,
      authEnabled: Boolean(context.authTokens),
      toolrunnerHardeningProfile: context.deploymentConfig.toolrunner.hardeningProfile,
    },
    approvalDal: context.container.approvalDal,
    desktopEnvironmentDal,
    presenceDal: context.container.presenceDal,
    policyOverrideDal: context.container.policyOverrideDal,
    nodePairingDal: context.container.nodePairingDal,
    engine: edgeEngine,
    policyService: context.container.policyService,
    locationService: new LocationService(context.container.db, {
      identityScopeDal: context.container.identityScopeDal,
      memoryDal: context.container.memoryDal,
      engine: edgeEngine,
      policyService: context.container.policyService,
      playbooks,
      playbookRunner: new PlaybookRunner(),
    }),
    modelsDev: context.container.modelsDev,
    modelCatalog: context.container.modelCatalog,
    maxBufferedBytes: wsMaxBufferedBytes,
    cluster: context.shouldRunEdge
      ? { edgeId: context.instanceId, outboxDal, connectionDirectory }
      : undefined,
    taskResults,
    hooks: hooksRuntime,
    onTaskResult: (taskId, success, result, evidence, error) =>
      taskResults.resolve(taskId, toTaskResult(success, result, evidence, error)),
    onConnectionClosed: (connectionId) => taskResults.rejectAllForConnection(connectionId),
  };

  const approvalEngineActionProcessor = approvalEngine
    ? new ApprovalEngineActionProcessor({
        db: context.container.db,
        engine: approvalEngine,
        owner: context.instanceId,
        logger: context.logger,
      })
    : undefined;
  approvalEngineActionProcessor?.start();

  const guardianReviewProcessor =
    context.shouldRunEdge || context.shouldRunWorker
      ? new GuardianReviewProcessor({
          container: context.container,
          secretProviderForTenant: context.secretProviderForTenant,
          owner: context.instanceId,
          logger: context.logger,
          wsEventDal,
          ws: {
            connectionManager,
            logger: context.logger,
            maxBufferedBytes: wsMaxBufferedBytes,
            cluster: context.shouldRunEdge
              ? {
                  edgeId: context.instanceId,
                  outboxDal,
                  connectionDirectory,
                }
              : undefined,
          },
        })
      : undefined;
  guardianReviewProcessor?.start();

  return {
    connectionManager,
    connectionDirectory,
    outboxDal,
    workSignalScheduler,
    wsEngine,
    edgeEngine,
    hooksRuntime,
    approvalEngineActionProcessor,
    guardianReviewProcessor,
    taskResults,
    protocolDeps,
  };
}

export async function startEdgeRuntime(
  context: GatewayBootContext,
  protocol: ProtocolRuntime,
  otel: OtelRuntime,
): Promise<EdgeRuntime> {
  if (!context.shouldRunEdge) {
    return {};
  }

  const pluginCatalogProvider = createPluginCatalogProvider({
    home: context.tyrumHome,
    userHome: context.tyrumHome,
    logger: context.logger,
    container: context.container,
  });
  const plugins = await pluginCatalogProvider.loadGlobalRegistry();
  protocol.protocolDeps.plugins = plugins;
  protocol.protocolDeps.pluginCatalogProvider = pluginCatalogProvider;

  const agents = context.deploymentConfig.agent.enabled
    ? new AgentRegistry({
        container: context.container,
        baseHome: context.tyrumHome,
        secretProviderForTenant: context.secretProviderForTenant,
        defaultPolicyService: context.container.policyService,
        plugins,
        pluginCatalogProvider,
        protocolDeps: protocol.protocolDeps,
        logger: context.logger,
      })
    : undefined;
  protocol.protocolDeps.agents = agents;

  const authRateLimitWindowS = context.deploymentConfig.auth.rateLimit.windowSeconds;
  const authRateLimitMax = context.deploymentConfig.auth.rateLimit.max;
  const wsUpgradeRateLimitMax = Math.max(1, Math.floor(authRateLimitMax / 2));

  const authRateLimiter = new SlidingWindowRateLimiter({
    windowMs: authRateLimitWindowS * 1_000,
    max: authRateLimitMax,
  });
  const wsUpgradeRateLimiter = new SlidingWindowRateLimiter({
    windowMs: authRateLimitWindowS * 1_000,
    max: wsUpgradeRateLimitMax,
  });
  const channelRuntimeBundle = startChannelRuntimeBundle({
    context,
    protocol,
    agents,
  });

  const app = createApp(context.container, {
    agents,
    telegramRuntime: channelRuntimeBundle.telegramRuntime,
    googleChatRuntime: channelRuntimeBundle.googleChatRuntime,
    plugins,
    pluginCatalogProvider,
    authTokens: context.authTokens,
    secretProviderForTenant: context.secretProviderForTenant,
    isLocalOnly: context.isLocalOnly,
    connectionManager: protocol.connectionManager,
    protocolDeps: protocol.protocolDeps,
    connectionDirectory: protocol.connectionDirectory,
    authRateLimiter,
    engine: protocol.edgeEngine,
    wsCluster: { edgeId: context.instanceId, outboxDal: protocol.outboxDal },
    runtime: {
      version: VERSION,
      instanceId: context.instanceId,
      role: context.role,
      otelEnabled: otel.enabled,
      desktopTakeoverAdvertiseOrigin: context.desktopTakeoverAdvertiseOrigin,
    },
  });

  const wsHandler = createWsHandler({
    connectionManager: protocol.connectionManager,
    protocolDeps: protocol.protocolDeps,
    authTokens: context.authTokens,
    trustedProxies: context.deploymentConfig.server.trustedProxies,
    upgradeRateLimiter: wsUpgradeRateLimiter,
    presenceDal: context.container.presenceDal,
    nodePairingDal: context.container.nodePairingDal,
    desktopEnvironmentDal: protocol.protocolDeps.desktopEnvironmentDal,
    cluster: { instanceId: context.instanceId, connectionDirectory: protocol.connectionDirectory },
  });

  const outboxPoller = new OutboxPoller({
    consumerId: context.instanceId,
    outboxDal: protocol.outboxDal,
    connectionManager: protocol.connectionManager,
    logger: context.logger,
    maxBufferedBytes: context.deploymentConfig.websocket.maxBufferedBytes,
  });
  outboxPoller.start();

  const workboardOrchestrator = agents
    ? new WorkboardOrchestrator({
        db: context.container.db,
        agents,
        redactionEngine: context.container.redactionEngine,
        approvalDal: context.container.approvalDal,
        policyService: context.container.policyService,
        protocolDeps: protocol.protocolDeps,
        owner: context.instanceId,
        logger: context.logger,
      })
    : undefined;
  workboardOrchestrator?.start();

  const workboardDispatcher = agents
    ? new WorkboardDispatcher({
        db: context.container.db,
        agents,
        defaultDeploymentConfig: context.container.deploymentConfig,
        redactionEngine: context.container.redactionEngine,
        approvalDal: context.container.approvalDal,
        policyService: context.container.policyService,
        protocolDeps: protocol.protocolDeps,
        owner: context.instanceId,
        logger: context.logger,
      })
    : undefined;
  workboardDispatcher?.start();

  const workboardReconciler = agents
    ? new WorkboardReconciler({
        db: context.container.db,
        redactionEngine: context.container.redactionEngine,
        approvalDal: context.container.approvalDal,
        policyService: context.container.policyService,
        protocolDeps: protocol.protocolDeps,
        logger: context.logger,
      })
    : undefined;
  workboardReconciler?.start();

  const subagentJanitor = agents
    ? new SubagentJanitor({
        db: context.container.db,
        conversationNodeAttachmentDal: context.container.conversationNodeAttachmentDal,
        logger: context.logger,
      })
    : undefined;
  subagentJanitor?.start();

  const serverResult = await createGatewayServer(context, app, wsHandler);
  return {
    plugins,
    pluginCatalogProvider,
    agents,
    workboardOrchestrator,
    workboardDispatcher,
    workboardReconciler,
    subagentJanitor,
    authRateLimiter,
    wsUpgradeRateLimiter,
    wsHandler,
    outboxPoller,
    telegramProcessor: channelRuntimeBundle.telegramProcessor,
    telegramPollingMonitor: channelRuntimeBundle.telegramPollingMonitor,
    discordMonitor: channelRuntimeBundle.discordMonitor,
    server: serverResult?.server,
    tlsFingerprint256: serverResult?.tlsFingerprint256,
  };
}

export function createWorkerLoop(
  context: GatewayBootContext,
  protocol: ProtocolRuntime,
): ExecutionWorkerLoop | undefined {
  if (!context.shouldRunWorker) return undefined;

  const engine = createWorkerExecutionEngine(context);
  const executor = createWorkerExecutionExecutor(context, protocol);

  return startExecutionWorkerLoop({
    engine,
    workerId: context.instanceId,
    executor,
    logger: context.logger,
  });
}

export function fireGatewayStartHook(context: GatewayBootContext, protocol: ProtocolRuntime): void {
  if (!context.shouldRunEdge)
    console.log(`Tyrum gateway v${VERSION} started in role '${context.role}'.`);

  if (protocol.hooksRuntime && context.shouldRunWorker) {
    void fireGatewayLifecycleHooks(context, protocol.hooksRuntime, {
      event: "gateway.start",
      metadata: { instance_id: context.instanceId, role: context.role },
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      context.logger.warn("hooks.fire_failed", { event: "gateway.start", error: message });
    });
  }
}
