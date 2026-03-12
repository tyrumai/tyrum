import type { Playbook } from "@tyrum/schemas";
import { Hono } from "hono";
import type { AppOptions } from "./app.js";
import type { GatewayContainer } from "./container.js";
import { createAgentsRoutes } from "./routes/agents.js";
import { createAgentConfigRoutes } from "./routes/agent-config.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createApprovalRoutes } from "./routes/approval.js";
import { createAutomationScheduleRoutes } from "./routes/automation-schedules.js";
import { createArtifactRoutes } from "./routes/artifact.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createAuthProfileRoutes } from "./routes/auth-profiles.js";
import { createAuthSessionRoutes } from "./routes/auth-session.js";
import { createAuthTokenRoutes } from "./routes/auth-token.js";
import { createCanvasRoutes } from "./routes/canvas.js";
import { createConnectionsRoute } from "./routes/connections.js";
import { createContextRoutes } from "./routes/context.js";
import { createContractRoutes } from "./routes/contracts.js";
import { createDeviceTokenRoutes } from "./routes/device-token.js";
import { createExtensionsRoutes } from "./routes/extensions.js";
import { createHealthRoute } from "./routes/health.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createMemoryExportRoutes } from "./routes/memory-export.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createModelConfigRoutes } from "./routes/model-config.js";
import { createModelsDevRoutes } from "./routes/models-dev.js";
import { createNodesRoute } from "./routes/nodes.js";
import { createOperatorUiRoutes } from "./routes/operator-ui.js";
import { createPairingRoutes } from "./routes/pairing.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createPlaybookRoutes } from "./routes/playbook.js";
import { policy } from "./routes/policy.js";
import { createGatewayConfigRoutes } from "./routes/gateway-config.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createProviderConfigRoutes } from "./routes/provider-config.js";
import { createProviderOAuthRoutes } from "./routes/provider-oauth.js";
import { createRoutingConfigRoutes } from "./routes/routing-config.js";
import { createSecretRoutes } from "./routes/secret.js";
import { createSharedStateConfigRoutes } from "./routes/shared-state-config.js";
import { createSnapshotRoutes } from "./routes/snapshot.js";
import { createStatusRoutes } from "./routes/status.js";
import { createSystemRoutes } from "./routes/system.js";
import { createToolRegistryRoutes } from "./routes/tool-registry.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createWatcherRoutes } from "./routes/watcher.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { ChannelConfigDal } from "./modules/channels/channel-config-dal.js";
import { TelegramChannelQueue } from "./modules/channels/telegram.js";
import { TelegramChannelRuntime } from "./modules/channels/telegram-runtime.js";
import { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { LifecycleHookConfigDal } from "./modules/hooks/config-dal.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { WsEventDal } from "./modules/ws-event/dal.js";
import { isAuthProfilesEnabled } from "./modules/models/auth-profiles-enabled.js";
import { gatewayMetrics } from "./modules/observability/metrics.js";
import { PolicyBundleConfigDal } from "./modules/policy/config-dal.js";
import { NodeInventoryService } from "./modules/node/inventory-service.js";
import { NodeCapabilityInspectionService } from "./modules/node/capability-inspection-service.js";
import { NodeDispatchService } from "./modules/agent/node-dispatch-service.js";
import { isSharedStateMode, resolveGatewayStateMode } from "./modules/runtime-state/mode.js";

export interface AppRouteDependencies {
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
  routingConfigDal: RoutingConfigDal;
  channelThreadDal: ChannelThreadDal;
  wsEventDal: WsEventDal;
}

export interface AppRouteContext {
  app: Hono;
  container: GatewayContainer;
  opts: AppOptions;
  runtime: { version: string; instanceId: string; role: string; otelEnabled: boolean };
  isLocalOnly: boolean;
  wsMaxBufferedBytes?: number;
  engine: AppOptions["engine"];
  secretProviderForTenant: AppOptions["secretProviderForTenant"];
  routeDeps: AppRouteDependencies;
}

export function createAppRouteDependencies(container: GatewayContainer): AppRouteDependencies {
  return {
    authProfileDal: new AuthProfileDal(container.db),
    pinDal: new SessionProviderPinDal(container.db),
    configuredModelPresetDal: new ConfiguredModelPresetDal(container.db),
    executionProfileModelAssignmentDal: new ExecutionProfileModelAssignmentDal(container.db),
    routingConfigDal: new RoutingConfigDal(container.db),
    channelThreadDal: new ChannelThreadDal(container.db),
    wsEventDal: new WsEventDal(container.db),
  };
}

function createWsRouteOptions(context: AppRouteContext) {
  if (!context.opts.connectionManager) return undefined;

  return {
    connectionManager: context.opts.connectionManager,
    maxBufferedBytes: context.wsMaxBufferedBytes,
    cluster: context.opts.wsCluster,
  };
}

function createClusterWsRouteOptions(context: AppRouteContext) {
  if (!context.opts.connectionManager) return undefined;

  return {
    connectionManager: context.opts.connectionManager,
    maxBufferedBytes: context.wsMaxBufferedBytes,
    cluster:
      context.opts.wsCluster && context.opts.connectionDirectory
        ? {
            ...context.opts.wsCluster,
            connectionDirectory: context.opts.connectionDirectory,
          }
        : undefined,
  };
}

function resolvePlaybooks(context: AppRouteContext): Playbook[] {
  const playbookHome = context.container.config?.tyrumHome;
  return (
    context.opts.playbooks ?? (playbookHome ? loadAllPlaybooks(`${playbookHome}/playbooks`) : [])
  );
}

export function registerSystemAndPublicRoutes(context: AppRouteContext): void {
  context.app.route("/", createHealthRoute({ isLocalOnly: context.isLocalOnly }));
  context.app.route("/", createMetricsRoutes({ registry: gatewayMetrics }));
  context.app.route(
    "/",
    createStatusRoutes({
      version: context.runtime.version,
      instanceId: context.runtime.instanceId,
      role: context.runtime.role,
      dbKind: context.container.db.kind,
      db: context.container.db,
      isLocalOnly: context.isLocalOnly,
      otelEnabled: context.runtime.otelEnabled,
      authEnabled: Boolean(context.opts.authTokens),
      toolrunnerHardeningProfile: context.container.deploymentConfig.toolrunner.hardeningProfile,
      connectionManager: context.opts.connectionManager,
      policyService: context.container.policyService,
      modelsDev: context.container.modelsDev,
      agents: context.opts.agents,
    }),
  );
  context.app.route("/", createContractRoutes());
  context.app.route(
    "/",
    createPresenceRoutes({
      instanceId: context.runtime.instanceId,
      version: context.runtime.version,
      role: context.runtime.role,
      presenceDal: context.container.presenceDal,
    }),
  );
  if (context.opts.connectionManager) {
    const inventoryService = new NodeInventoryService({
      connectionManager: context.opts.connectionManager,
      connectionDirectory: context.opts.connectionDirectory,
      nodePairingDal: context.container.nodePairingDal,
      presenceDal: context.container.presenceDal,
      attachmentDal: context.container.sessionLaneNodeAttachmentDal,
    });
    const inspectionService = context.opts.protocolDeps
      ? new NodeCapabilityInspectionService({
          connectionManager: context.opts.connectionManager,
          connectionDirectory: context.opts.connectionDirectory,
          nodeInventoryService: inventoryService,
        })
      : undefined;
    context.app.route(
      "/",
      createNodesRoute({
        inventoryService,
        inspectionService,
        nodeDispatchService: context.opts.protocolDeps
          ? new NodeDispatchService(context.opts.protocolDeps)
          : undefined,
        artifactStore: context.container.artifactStore,
      }),
    );
  }
  context.app.route(
    "/",
    createUsageRoutes({
      db: context.container.db,
      authProfileDal: context.routeDeps.authProfileDal,
      pinDal: context.routeDeps.pinDal,
      secretProviderForTenant: context.secretProviderForTenant,
      logger: context.container.logger,
    }),
  );
  context.app.route("/", policy);
  context.app.route(
    "/",
    createPolicyBundleRoutes({
      logger: context.container.logger,
      policyService: context.container.policyService,
      policyOverrideDal: context.container.policyOverrideDal,
      wsEventDal: context.routeDeps.wsEventDal,
      ws: createWsRouteOptions(context),
    }),
  );
}

export function registerAuthAndSecurityRoutes(context: AppRouteContext): void {
  if (context.opts.authTokens) {
    context.app.route("/", createAuthSessionRoutes({ authTokens: context.opts.authTokens }));
    context.app.route(
      "/",
      createAuthTokenRoutes({
        authTokens: context.opts.authTokens,
        connectionManager: context.opts.connectionManager,
      }),
    );
    context.app.route(
      "/",
      createDeviceTokenRoutes({
        authTokens: context.opts.authTokens,
        connectionManager: context.opts.connectionManager,
      }),
    );
    context.app.route(
      "/",
      createSystemRoutes({
        db: context.container.db,
        authTokens: context.opts.authTokens,
      }),
    );
  }

  context.app.route(
    "/",
    createAuthProfileRoutes({
      authProfileDal: context.routeDeps.authProfileDal,
      pinDal: context.routeDeps.pinDal,
    }),
  );

  context.app.route(
    "/",
    createApprovalRoutes({
      approvalDal: context.container.approvalDal,
      logger: context.container.logger,
      policyOverrideDal: context.container.policyOverrideDal,
      wsEventDal: context.routeDeps.wsEventDal,
      ws: createWsRouteOptions(context),
    }),
  );

  if (context.secretProviderForTenant) {
    context.app.route(
      "/",
      createSecretRoutes({
        secretProviderForTenant: context.secretProviderForTenant,
      }),
    );
  }
}

export function registerModelsAndConfigRoutes(context: AppRouteContext): void {
  context.app.route(
    "/",
    createModelsDevRoutes({
      modelsDev: context.container.modelsDev,
      modelCatalog: context.container.modelCatalog,
    }),
  );

  if (context.secretProviderForTenant) {
    context.app.route(
      "/",
      createProviderConfigRoutes({
        db: context.container.db,
        authProfileDal: context.routeDeps.authProfileDal,
        modelCatalog: context.container.modelCatalog,
        secretProviderForTenant: context.secretProviderForTenant,
        configuredModelPresetDal: context.routeDeps.configuredModelPresetDal,
        executionProfileModelAssignmentDal: context.routeDeps.executionProfileModelAssignmentDal,
      }),
    );
  }

  context.app.route(
    "/",
    createModelConfigRoutes({
      db: context.container.db,
      modelCatalog: context.container.modelCatalog,
      authProfileDal: context.routeDeps.authProfileDal,
      configuredModelPresetDal: context.routeDeps.configuredModelPresetDal,
      executionProfileModelAssignmentDal: context.routeDeps.executionProfileModelAssignmentDal,
    }),
  );

  if (context.secretProviderForTenant && isAuthProfilesEnabled()) {
    context.app.route(
      "/",
      createProviderOAuthRoutes({
        oauthPendingDal: context.container.oauthPendingDal,
        oauthProviderRegistry: context.container.oauthProviderRegistry,
        authProfileDal: context.routeDeps.authProfileDal,
        secretProviderForTenant: context.secretProviderForTenant,
        logger: context.container.logger,
      }),
    );
  }

  if (context.opts.plugins) {
    context.app.route(
      "/",
      createPluginRoutes({
        plugins: context.opts.plugins,
        pluginCatalogProvider: context.opts.pluginCatalogProvider,
      }),
    );
  }

  context.app.route(
    "/",
    createToolRegistryRoutes({
      agents: context.opts.agents,
      db: context.container.db,
      logger: context.container.logger,
      plugins: context.opts.plugins,
      pluginCatalogProvider: context.opts.pluginCatalogProvider,
      stateMode: resolveGatewayStateMode(context.container.deploymentConfig),
    }),
  );

  context.app.route(
    "/",
    createRoutingConfigRoutes({
      db: context.container.db,
      logger: context.container.logger,
      routingConfigDal: context.routeDeps.routingConfigDal,
      channelThreadDal: context.routeDeps.channelThreadDal,
      ws: createWsRouteOptions(context),
    }),
  );
}

export function registerExecutionAndWorkflowRoutes(context: AppRouteContext): void {
  context.app.route("/", createPlanRoutes(context.container));

  if (context.engine) {
    context.app.route(
      "/",
      createWorkflowRoutes({
        engine: context.engine,
        policyService: context.container.policyService,
        agents: context.opts.agents,
        identityScopeDal: context.container.identityScopeDal,
      }),
    );
  }

  context.app.route(
    "/",
    createWatcherRoutes(context.container.watcherProcessor, {
      secretProviderForTenant: context.secretProviderForTenant,
    }),
  );
  context.app.route("/", createAutomationScheduleRoutes(context.container));

  context.app.route(
    "/",
    createCanvasRoutes({
      canvasDal: context.container.canvasDal,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );

  const playbookRunner = new PlaybookRunner();
  context.app.route(
    "/",
    createPlaybookRoutes({
      playbooks: resolvePlaybooks(context),
      runner: playbookRunner,
      engine: context.engine,
      policyService: context.container.policyService,
      approvalDal: context.container.approvalDal,
      db: context.container.db,
    }),
  );
}

export function registerAgentsAndWorkspaceRoutes(context: AppRouteContext): void {
  const telegramRuntime =
    context.opts.telegramRuntime ??
    new TelegramChannelRuntime(new ChannelConfigDal(context.container.db));
  context.app.route(
    "/",
    createPairingRoutes({
      logger: context.container.logger,
      nodePairingDal: context.container.nodePairingDal,
      wsEventDal: context.routeDeps.wsEventDal,
      ws: createClusterWsRouteOptions(context),
    }),
  );

  context.app.route(
    "/",
    createIngressRoutes({
      telegramRuntime,
      telegramQueue: context.opts.agents
        ? new TelegramChannelQueue(context.container.db, {
            sessionDal: context.container.sessionDal,
            logger: context.container.logger,
            ws: createWsRouteOptions(context),
          })
        : undefined,
      agents: context.opts.agents,
      memoryV1Dal: context.container.memoryV1Dal,
      routingConfigDal: context.routeDeps.routingConfigDal,
      logger: context.container.logger,
    }),
  );

  context.app.route(
    "/",
    createAgentsRoutes({
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
      stateMode: resolveGatewayStateMode(context.container.deploymentConfig),
    }),
  );
  context.app.route(
    "/",
    createAgentConfigRoutes({
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
      stateMode: resolveGatewayStateMode(context.container.deploymentConfig),
    }),
  );
  if (isSharedStateMode(context.container.deploymentConfig)) {
    context.app.route(
      "/",
      createGatewayConfigRoutes({
        db: context.container.db,
        identityScopeDal: context.container.identityScopeDal,
        hooksDal: new LifecycleHookConfigDal(context.container.db),
        policyBundleDal: new PolicyBundleConfigDal(context.container.db),
      }),
    );
    context.app.route(
      "/",
      createSharedStateConfigRoutes({
        db: context.container.db,
        identityScopeDal: context.container.identityScopeDal,
        pluginCatalogProvider: context.opts.pluginCatalogProvider,
      }),
    );
  }

  if (context.opts.connectionManager) {
    context.app.route("/", createConnectionsRoute(context.opts.connectionManager));
  }

  if (context.opts.agents) {
    context.app.route(
      "/",
      createAgentRoutes({
        agents: context.opts.agents,
        db: context.container.db,
      }),
    );
    context.app.route(
      "/",
      createContextRoutes({
        agents: context.opts.agents,
        contextReportDal: context.container.contextReportDal,
      }),
    );
  }
}

export function registerArtifactsAuditAndUiRoutes(context: AppRouteContext): void {
  context.app.route(
    "/",
    createMemoryExportRoutes({ artifactStore: context.container.artifactStore }),
  );
  context.app.route(
    "/",
    createExtensionsRoutes({
      db: context.container.db,
      container: context.container,
    }),
  );

  context.app.route(
    "/",
    createAuditRoutes({
      db: context.container.db,
      eventLog: context.container.eventLog,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );

  context.app.route(
    "/",
    createSnapshotRoutes({
      db: context.container.db,
      version: context.runtime.version,
      importEnabled: context.container.deploymentConfig.snapshots.importEnabled,
    }),
  );

  context.app.route(
    "/",
    createArtifactRoutes({
      db: context.container.db,
      artifactStore: context.container.artifactStore,
      logger: context.container.logger,
      policySnapshotDal: context.container.policySnapshotDal,
      policyService: context.container.policyService,
    }),
  );

  context.app.route("/", createOperatorUiRoutes({ assetsDir: context.opts.operatorUiAssetsDir }));
}
