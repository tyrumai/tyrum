import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "../app.js";
import { NodeDispatchService } from "../modules/agent/node-dispatch-service.js";
import { AgentRegistry } from "../modules/agent/registry.js";
import { AuthAudit } from "../modules/auth/audit.js";
import { SlidingWindowRateLimiter } from "../modules/auth/rate-limiter.js";
import { ArtifactLifecycleScheduler } from "../modules/artifact/lifecycle.js";
import { ApprovalEngineActionProcessor } from "../modules/approval/engine-action-processor.js";
import { WsNotifier } from "../modules/approval/notifier.js";
import { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { OutboxDal } from "../modules/backplane/outbox-dal.js";
import { OutboxLifecycleScheduler } from "../modules/backplane/outbox-lifecycle.js";
import { OutboxPoller } from "../modules/backplane/outbox-poller.js";
import { TelegramChannelProcessor } from "../modules/channels/telegram.js";
import { ExecutionEngine, type StepExecutor as ExecutionStepExecutor } from "../modules/execution/engine.js";
import { createGatewayStepExecutor } from "../modules/execution/gateway-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "../modules/execution/kubernetes-toolrunner-step-executor.js";
import { createNodeDispatchStepExecutor } from "../modules/execution/node-dispatch-step-executor.js";
import { createToolRunnerStepExecutor } from "../modules/execution/toolrunner-step-executor.js";
import { startExecutionWorkerLoop, type ExecutionWorkerLoop } from "../modules/execution/worker-loop.js";
import { LifecycleHooksRuntime } from "../modules/hooks/runtime.js";
import { createMemoryV1BudgetsProvider } from "../modules/memory/v1-budgets-provider.js";
import { gatewayMetrics } from "../modules/observability/metrics.js";
import type { OtelRuntime } from "../modules/observability/otel.js";
import { PluginRegistry } from "../modules/plugins/registry.js";
import { StateStoreLifecycleScheduler } from "../modules/statestore/lifecycle.js";
import { ensureSelfSignedTlsMaterial } from "../modules/tls/self-signed.js";
import { WatcherScheduler } from "../modules/watcher/scheduler.js";
import { WsEventDal } from "../modules/ws-event/dal.js";
import { WorkSignalScheduler } from "../modules/workboard/signal-scheduler.js";
import { createWsHandler } from "../routes/ws.js";
import { isPostgresDbUri } from "../statestore/db-uri.js";
import { VERSION } from "../version.js";
import { ConnectionManager } from "../ws/connection-manager.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import { TaskResultRegistry, type TaskResult } from "../ws/protocol/task-result-registry.js";
import { resolveGatewayEntrypointPath } from "./entrypoint-path.js";
import type { BackgroundSchedulers, EdgeRuntime, GatewayBootContext, GatewayRuntime, GatewayServer, ProtocolRuntime } from "./runtime-shared.js";

function createExecutionEngine(context: GatewayBootContext, options?: { includeSecrets?: boolean }): ExecutionEngine {
  return new ExecutionEngine({
    db: context.container.db,
    redactionEngine: context.container.redactionEngine,
    secretProviderForTenant:
      options?.includeSecrets === false ? undefined : context.secretProviderForTenant,
    policyService: context.container.policyService,
    logger: context.logger,
  });
}

function toTaskResult(success: boolean, result: unknown, evidence: unknown, error: string | undefined): TaskResult {
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

export function startBackgroundSchedulers(context: GatewayBootContext): BackgroundSchedulers {
  const keepProcessAlive = context.role === "scheduler";
  const shouldRunScheduler = context.role === "all" || context.role === "scheduler";
  const watcherScheduler = shouldRunScheduler
    ? new WatcherScheduler({
        db: context.container.db,
        memoryV1Dal: context.container.memoryV1Dal,
        eventBus: context.container.eventBus,
        automationEnabled: context.deploymentConfig.automation.enabled,
        keepProcessAlive,
      })
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
        channelTerminalRetentionDays: context.deploymentConfig.lifecycle.channels.terminalRetentionDays,
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
  return { watcherScheduler, artifactLifecycleScheduler, outboxLifecycleScheduler, stateStoreLifecycleScheduler };
}

export async function createProtocolRuntime(context: GatewayBootContext, otel: OtelRuntime): Promise<ProtocolRuntime> {
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
  const hooksRuntime =
    context.lifecycleHooks.length > 0 && (context.shouldRunEdge || context.shouldRunWorker)
      ? new LifecycleHooksRuntime({
        db: context.container.db,
        engine: approvalEngine!,
        policyService: context.container.policyService,
        hooks: context.lifecycleHooks,
      })
      : undefined;

  const taskResults = new TaskResultRegistry();
  const wsEventDal = new WsEventDal(context.container.db);
  const protocolDeps: ProtocolDeps = {
    connectionManager,
    logger: context.logger,
    db: context.container.db,
    wsEventDal,
    redactionEngine: context.container.redactionEngine,
    memoryV1Dal: context.container.memoryV1Dal,
    artifactStore: context.container.artifactStore,
    authAudit: new AuthAudit({ eventLog: context.container.eventLog, logger: context.logger }),
    contextReportDal: context.container.contextReportDal,
    runtime: {
      version: VERSION,
      instanceId: context.instanceId,
      role: context.role,
      dbKind: context.container.db.kind,
      isExposed: !context.isLocalOnly,
      otelEnabled: otel.enabled,
    },
    approvalDal: context.container.approvalDal,
    presenceDal: context.container.presenceDal,
    policyOverrideDal: context.container.policyOverrideDal,
    nodePairingDal: context.container.nodePairingDal,
    engine: edgeEngine,
    policyService: context.container.policyService,
    modelsDev: context.container.modelsDev,
    modelCatalog: context.container.modelCatalog,
    maxBufferedBytes: wsMaxBufferedBytes,
    cluster: context.shouldRunEdge ? { edgeId: context.instanceId, outboxDal, connectionDirectory } : undefined,
    taskResults,
    hooks: hooksRuntime,
    onTaskResult: (taskId, success, result, evidence, error) =>
      taskResults.resolve(taskId, toTaskResult(success, result, evidence, error)),
    onConnectionClosed: (connectionId) => taskResults.rejectAllForConnection(connectionId),
    onApprovalDecision: (tenantId: string, approvalId: string, approved: boolean, reason: string | undefined) => {
      void context.container.approvalDal
        .resolveWithEngineAction({
          tenantId,
          approvalId,
          decision: approved ? "approved" : "denied",
          reason,
          resolvedBy: { kind: "ws.operator" },
        })
        .then((res) => {
          const row = res?.approval;
          const transitioned = res?.transitioned ?? false;
          const desiredStatus = approved ? "approved" : "denied";
          context.logger.info("approval.decided", {
            approval_id: approvalId,
            approved,
            status: row?.status ?? "missing",
            reason,
            decision_matches: row?.status === desiredStatus,
            transitioned,
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          context.logger.error("approval.decide_failed", { approval_id: approvalId, approved, reason, error: message });
        });
    },
  };

  protocolDeps.memoryV1BudgetsProvider = createMemoryV1BudgetsProvider(context.container.db);
  const approvalEngineActionProcessor = approvalEngine
    ? new ApprovalEngineActionProcessor({
        db: context.container.db,
        engine: approvalEngine,
        owner: context.instanceId,
        logger: context.logger,
      })
    : undefined;
  approvalEngineActionProcessor?.start();

  return { connectionManager, connectionDirectory, outboxDal, workSignalScheduler, wsEngine, edgeEngine, hooksRuntime, approvalEngineActionProcessor, taskResults, protocolDeps, approvalNotifier: new WsNotifier(protocolDeps) };
}

async function createGatewayServer(
  context: GatewayBootContext,
  app: ReturnType<typeof createApp> | undefined,
  wsHandler: ReturnType<typeof createWsHandler> | undefined,
): Promise<GatewayServer | undefined> {
  if (!context.shouldRunEdge || !app || !wsHandler) {
    return undefined;
  }

  const listener = getRequestListener(app.fetch);
  const tlsSelfSigned = context.deploymentConfig.server.tlsSelfSigned ?? false;
  const { server, tlsMaterial } = await (async () => {
    if (!tlsSelfSigned) {
      return { server: createHttpServer(listener), tlsMaterial: null };
    }
    const material = await ensureSelfSignedTlsMaterial({ home: context.tyrumHome });
    return {
      server: createHttpsServer({ key: material.keyPem, cert: material.certPem }, listener),
      tlsMaterial: material,
    };
  })();

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wsHandler.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(context.port, context.host, () => {
    const scheme = tlsSelfSigned ? "https" : "http";
    context.logger.info("gateway.listen", {
      host: context.host,
      port: context.port,
      url: `${scheme}://${context.host}:${context.port}`,
      tls_self_signed: tlsSelfSigned,
      tls_fingerprint256: tlsMaterial?.fingerprint256 ?? null,
    });

    if (tlsSelfSigned && tlsMaterial) {
      console.log("---");
      console.log("TLS enabled (self-signed). Browsers will show a warning unless trusted.");
      console.log(`TLS fingerprint (SHA-256): ${tlsMaterial.fingerprint256}`);
      console.log(`TLS certificate: ${tlsMaterial.certPath}`);
      console.log(`TLS key: ${tlsMaterial.keyPath}`);
      console.log(`UI: https://${context.host}:${context.port}/ui`);
      console.log(`WS: wss://${context.host}:${context.port}/ws`);
      console.log("Verify the fingerprint out-of-band (e.g. SSH) before trusting.");
      console.log("---");
    }
  });

  return server;
}

export async function startEdgeRuntime(
  context: GatewayBootContext,
  protocol: ProtocolRuntime,
  otel: OtelRuntime,
): Promise<EdgeRuntime> {
  if (!context.shouldRunEdge) {
    return {};
  }

  const plugins = await PluginRegistry.load({
    home: context.tyrumHome,
    userHome: context.tyrumHome,
    logger: context.logger,
    container: context.container,
  });
  protocol.protocolDeps.plugins = plugins;

  const agents = context.deploymentConfig.agent.enabled
    ? new AgentRegistry({
      container: context.container,
      baseHome: context.tyrumHome,
      secretProviderForTenant: context.secretProviderForTenant,
      defaultPolicyService: context.container.policyService,
      approvalNotifier: protocol.approvalNotifier,
      plugins,
      protocolDeps: protocol.protocolDeps,
      logger: context.logger,
    })
    : undefined;
  protocol.protocolDeps.agents = agents;

  const authRateLimitWindowS = context.deploymentConfig.auth.rateLimit.windowSeconds;
  const authRateLimitMax = context.deploymentConfig.auth.rateLimit.max;
  const wsUpgradeRateLimitMax = Math.max(1, Math.floor(authRateLimitMax / 2));

  const authRateLimiter = new SlidingWindowRateLimiter({ windowMs: authRateLimitWindowS * 1_000, max: authRateLimitMax });
  const wsUpgradeRateLimiter = new SlidingWindowRateLimiter({ windowMs: authRateLimitWindowS * 1_000, max: wsUpgradeRateLimitMax });

  const app = createApp(context.container, {
    agents,
    plugins,
    authTokens: context.authTokens,
    secretProviderForTenant: context.secretProviderForTenant,
    isLocalOnly: context.isLocalOnly,
    connectionManager: protocol.connectionManager,
    connectionDirectory: protocol.connectionDirectory,
    authRateLimiter,
    engine: protocol.edgeEngine,
    wsCluster: { edgeId: context.instanceId, outboxDal: protocol.outboxDal },
    runtime: { version: VERSION, instanceId: context.instanceId, role: context.role, otelEnabled: otel.enabled },
  });

  const wsHandler = createWsHandler({
    connectionManager: protocol.connectionManager,
    protocolDeps: protocol.protocolDeps,
    authTokens: context.authTokens,
    trustedProxies: context.deploymentConfig.server.trustedProxies,
    upgradeRateLimiter: wsUpgradeRateLimiter,
    presenceDal: context.container.presenceDal,
    nodePairingDal: context.container.nodePairingDal,
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

  const telegramProcessor =
    agents && context.container.telegramBot && context.deploymentConfig.channels.pipelineEnabled
      ? new TelegramChannelProcessor({
        db: context.container.db,
        sessionDal: context.container.sessionDal,
        agents,
        telegramBot: context.container.telegramBot,
        owner: context.instanceId,
        logger: context.logger,
        typingMode: context.deploymentConfig.channels.typingMode,
        typingRefreshMs: context.deploymentConfig.channels.typingRefreshMs,
        typingAutomationEnabled: context.deploymentConfig.channels.typingAutomationEnabled,
        memoryV1Dal: context.container.memoryV1Dal,
        approvalDal: context.container.approvalDal,
        approvalNotifier: protocol.approvalNotifier,
      })
      : undefined;
  telegramProcessor?.start();

  const server = await createGatewayServer(context, app, wsHandler);
  return { plugins, agents, authRateLimiter, wsUpgradeRateLimiter, wsHandler, outboxPoller, telegramProcessor, server };
}

export function createWorkerLoop(context: GatewayBootContext, protocol: ProtocolRuntime): ExecutionWorkerLoop | undefined {
  if (!context.shouldRunWorker) return undefined;

  const engine = createExecutionEngine(context);
  const resolveExecutor = (): ExecutionStepExecutor => {
    const toolrunner = context.deploymentConfig.execution.toolrunner;
    if (toolrunner.launcher === "kubernetes") {
      if (!isPostgresDbUri(context.dbPath))
        throw new Error("execution.toolrunner.launcher=kubernetes requires --db to be a Postgres URI");
      return createKubernetesToolRunnerStepExecutor({
        namespace: toolrunner.namespace,
        image: toolrunner.image,
        workspacePvcClaim: toolrunner.workspacePvcClaim,
        tyrumHome: context.tyrumHome,
        dbPath: context.dbPath,
        hardeningProfile: context.deploymentConfig.toolrunner.hardeningProfile,
        logger: context.logger,
        jobTtlSeconds: 300,
      });
    }

    return createToolRunnerStepExecutor({
      entrypoint: resolveGatewayEntrypointPath(process.argv[1]),
      home: context.tyrumHome,
      dbPath: context.dbPath,
      migrationsDir: context.migrationsDir,
      logger: context.logger,
    });
  };

  const toolExecutor = resolveExecutor() satisfies ExecutionStepExecutor;
  const nodeDispatchExecutor = createNodeDispatchStepExecutor({
    db: context.container.db,
    artifactStore: context.container.artifactStore,
    nodeDispatchService: new NodeDispatchService(protocol.protocolDeps),
    fallback: toolExecutor,
  }) satisfies ExecutionStepExecutor;
  const executor = createGatewayStepExecutor({ container: context.container, toolExecutor: nodeDispatchExecutor }) satisfies ExecutionStepExecutor;

  return startExecutionWorkerLoop({ engine, workerId: context.instanceId, executor, logger: context.logger });
}

export function fireGatewayStartHook(context: GatewayBootContext, protocol: ProtocolRuntime): void {
  if (!context.shouldRunEdge) console.log(`Tyrum gateway v${VERSION} started in role '${context.role}'.`);

  if (protocol.hooksRuntime && context.shouldRunWorker) {
      void protocol.hooksRuntime
      .fire({
        event: "gateway.start",
        metadata: { instance_id: context.instanceId, role: context.role },
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        context.logger.warn("hooks.fire_failed", { event: "gateway.start", error: message });
      });
  }
}

export function createShutdownHandler(context: GatewayBootContext, runtime: GatewayRuntime): (signal: string) => void {
  let shuttingDown = false;

  return (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Gateway shutting down (${signal})`);
    const shutdownStartedAtMs = Date.now();
    const hardExitTimeoutMs = 15_000;
    const hardExitDeadlineMs = shutdownStartedAtMs + hardExitTimeoutMs;

    const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
    const waitForRunsToStart = async (runIds: readonly string[], timeoutMs: number): Promise<void> => {
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
    };

    const hardExitTimer = setTimeout(() => {
      console.warn("Gateway forced shutdown after 15 seconds.");
      process.exit(1);
    }, hardExitTimeoutMs);
    hardExitTimer.unref();

    const closeServer = new Promise<void>((resolve) => {
      try {
        if (!runtime.edge.server) return resolve();
        runtime.edge.server.close(() => resolve());
      } catch { resolve(); }
    });

    runtime.edge.wsHandler?.stopHeartbeat();
    runtime.edge.authRateLimiter?.stop();
    runtime.edge.wsUpgradeRateLimiter?.stop();

    const shutdownHookRuns =
      runtime.protocol.hooksRuntime && context.shouldRunWorker
        ? runtime.protocol.hooksRuntime
            .fire({
              event: "gateway.shutdown",
              metadata: { signal, instance_id: context.instanceId, role: context.role },
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              context.logger.warn("hooks.fire_failed", { event: "gateway.shutdown", error: message });
              return [];
            })
        : Promise.resolve([]);

    const stopWorker = (async () => {
      if (!runtime.workerLoop) return;
      try {
        const runIds = await shutdownHookRuns;
        if (runIds.length > 0) {
          const remainingMs = Math.max(0, hardExitDeadlineMs - Date.now() - 250);
          await waitForRunsToStart(runIds, remainingMs);
        }
      } finally {
        runtime.workerLoop.stop();
        await runtime.workerLoop.done;
      }
    })();

    const closeWss = new Promise<void>((resolve) => {
      try {
        if (!runtime.edge.wsHandler) return resolve();
        runtime.edge.wsHandler.wss.close(() => resolve());
      } catch { resolve(); }
    });

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
      [closeServer, closeWss, shutdownHookRuns, runtime.edge.agents?.shutdown() ?? Promise.resolve(), runtime.otel.shutdown(), stopWorker],
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
