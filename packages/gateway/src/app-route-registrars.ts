import { Hono } from "hono";
import type { AppOptions } from "./app.js";
export { createAppRouteDependencies } from "./app-route-support.js";
export { registerArtifactsAuditAndUiRoutes } from "./app-route-registrars-artifacts.js";
import {
  createClusterWsRouteOptions,
  createExecutionRouteServices,
  createWsRouteOptions,
} from "./app-route-support.js";
import type { GatewayContainer } from "./container.js";
import { createAgentsRoutes } from "./routes/agents.js";
import { createAgentConfigRoutes } from "./routes/agent-config.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createApprovalRoutes } from "./routes/approval.js";
import { createAutomationScheduleRoutes } from "./routes/automation-schedules.js";
import { createAutomationTriggerRoutes } from "./routes/automation-triggers.js";
import { createAuthProfileRoutes } from "./routes/auth-profiles.js";
import { createAuthCookieRoutes } from "./routes/auth-cookie.js";
import { createAuthTokenRoutes } from "./routes/auth-token.js";
import { createCanvasRoutes } from "./routes/canvas.js";
import { createChannelConfigRoutes } from "./routes/channel-config.js";
import { createConnectionsRoute } from "./routes/connections.js";
import { createContextRoutes } from "./routes/context.js";
import { createContractRoutes } from "./routes/contracts.js";
import { createDeviceTokenRoutes } from "./routes/device-token.js";
import { createDesktopEnvironmentRoutes } from "./routes/desktop-environments.js";
import { createHealthRoute } from "./routes/health.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createModelConfigRoutes } from "./routes/model-config.js";
import { createModelsDevRoutes } from "./routes/models-dev.js";
import { createNodesRoute } from "./routes/nodes.js";
import { createPairingRoutes } from "./routes/pairing.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createPlaybookRoutes } from "./routes/playbook.js";
import { policy } from "./routes/policy.js";
import { createGatewayConfigRoutes, createPolicyConfigRoutes } from "./routes/gateway-config.js";
import { createLocationRoutes } from "./routes/location.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createProviderConfigRoutes } from "./routes/provider-config.js";
import { createProviderOAuthRoutes } from "./routes/provider-oauth.js";
import { createRoutingConfigRoutes } from "./routes/routing-config.js";
import { createSecretRoutes } from "./routes/secret.js";
import { createSharedStateConfigRoutes } from "./routes/shared-state-config.js";
import { createSpecRoutes } from "./routes/specs.js";
import { createStatusRoutes } from "./routes/status.js";
import { createSystemRoutes } from "./routes/system.js";
import { createToolRegistryRoutes } from "./routes/tool-registry.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createWatcherRoutes } from "./routes/watcher.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { ChannelConfigDal } from "./modules/channels/channel-config-dal.js";
import type { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import { TelegramChannelQueue } from "./modules/channels/telegram.js";
import { TelegramChannelRuntime } from "./modules/channels/telegram-runtime.js";
import { GoogleChatChannelRuntime } from "./modules/channels/googlechat-runtime.js";
import { LifecycleHookConfigDal } from "./modules/hooks/config-dal.js";
import type { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import type { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import type { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import type { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { isAuthProfilesEnabled } from "./modules/models/auth-profiles-enabled.js";
import type { ConversationProviderPinDal } from "./modules/models/conversation-pin-dal.js";
import { gatewayMetrics } from "./modules/observability/metrics.js";
import { PolicyBundleConfigDal } from "./modules/policy/config-dal.js";
import { listCapabilityCatalogEntries } from "./modules/node/capability-catalog.js";
import { createNodeDispatchServiceFromProtocolDeps } from "./modules/node/runtime-node-control-adapters.js";
import { NodeCapabilityInspectionService } from "./modules/node/capability-inspection-service.js";
import { isSharedStateMode, resolveGatewayStateMode } from "./modules/runtime-state/mode.js";
import type { WsEventDal } from "./modules/ws-event/dal.js";
import {
  DesktopEnvironmentLifecycleService,
  UnsupportedDesktopEnvironmentLifecycleService,
} from "./modules/desktop-environments/lifecycle-service.js";
import { NodeInventoryService } from "@tyrum/runtime-node-control";
import type {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "./modules/desktop-environments/dal.js";

export interface AppRouteDependencies {
  authProfileDal: AuthProfileDal;
  pinDal: ConversationProviderPinDal;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
  routingConfigDal: RoutingConfigDal;
  channelThreadDal: ChannelThreadDal;
  wsEventDal: WsEventDal;
  desktopEnvironmentDal: DesktopEnvironmentDal;
  desktopEnvironmentHostDal: DesktopEnvironmentHostDal;
}

export interface AppRouteContext {
  app: Hono;
  container: GatewayContainer;
  opts: AppOptions;
  runtime: {
    version: string;
    instanceId: string;
    role: string;
    otelEnabled: boolean;
    desktopTakeoverAdvertiseOrigin?: string;
  };
  isLocalOnly: boolean;
  channelPipelineEnabled: boolean;
  wsMaxBufferedBytes?: number;
  engine: AppOptions["engine"];
  workflowRunner: AppOptions["workflowRunner"];
  secretProviderForTenant: AppOptions["secretProviderForTenant"];
  routeDeps: AppRouteDependencies;
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
  context.app.route("/", createSpecRoutes());
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
      attachmentDal: context.container.conversationNodeAttachmentDal,
      capabilityCatalogEntries: listCapabilityCatalogEntries(),
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
          ? createNodeDispatchServiceFromProtocolDeps(context.opts.protocolDeps)
          : undefined,
        artifactStore: context.container.artifactStore,
        desktopEnvironmentDal: context.routeDeps.desktopEnvironmentDal,
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
    createDesktopEnvironmentRoutes({
      db: context.container.db,
      defaultDeploymentConfig: context.container.deploymentConfig,
      publicBaseUrl: context.container.deploymentConfig.server.publicBaseUrl,
      desktopTakeoverAdvertiseOrigin: context.runtime.desktopTakeoverAdvertiseOrigin,
      hostDal: context.routeDeps.desktopEnvironmentHostDal,
      environmentDal: context.routeDeps.desktopEnvironmentDal,
      logger: context.container.logger,
      lifecycleService:
        context.opts.desktopEnvironmentLifecycle ??
        (context.runtime.role === "all" || context.runtime.role === "desktop-runtime"
          ? new DesktopEnvironmentLifecycleService(context.routeDeps.desktopEnvironmentDal)
          : new UnsupportedDesktopEnvironmentLifecycleService()),
    }),
  );
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
    context.app.route("/", createAuthCookieRoutes({ authTokens: context.opts.authTokens }));
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
      desktopEnvironmentDal: context.routeDeps.desktopEnvironmentDal,
      db: context.container.db,
      logger: context.container.logger,
      policyOverrideDal: context.container.policyOverrideDal,
      redactionEngine: context.container.redactionEngine,
      policyService: context.container.policyService,
      wsEventDal: context.routeDeps.wsEventDal,
      ws: createClusterWsRouteOptions(context),
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
        identityScopeDal: context.container.identityScopeDal,
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
    createChannelConfigRoutes({
      db: context.container.db,
      routingConfigDal: context.routeDeps.routingConfigDal,
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
  const { playbookRunner, playbooks, locationService } = createExecutionRouteServices(context);

  if (context.workflowRunner) {
    context.app.route(
      "/",
      createWorkflowRoutes({
        db: context.container.db,
        workflowRunner: context.workflowRunner,
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
  context.app.route("/", createAutomationTriggerRoutes(locationService));
  context.app.route("/", createLocationRoutes(locationService));

  context.app.route(
    "/",
    createCanvasRoutes({
      canvasDal: context.container.canvasDal,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );

  context.app.route(
    "/",
    createPlaybookRoutes({
      playbooks,
      runner: playbookRunner,
      engine: context.engine,
      policyService: context.container.policyService,
      approvalDal: context.container.approvalDal,
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );
}

export function registerAgentsAndWorkspaceRoutes(context: AppRouteContext): void {
  const telegramRuntime =
    context.opts.telegramRuntime ??
    new TelegramChannelRuntime(
      new ChannelConfigDal(context.container.db),
      context.container.artifactStore,
    );
  const googleChatRuntime =
    context.opts.googleChatRuntime ??
    new GoogleChatChannelRuntime(new ChannelConfigDal(context.container.db));
  context.app.route(
    "/",
    createPairingRoutes({
      logger: context.container.logger,
      nodePairingDal: context.container.nodePairingDal,
      desktopEnvironmentDal: context.routeDeps.desktopEnvironmentDal,
      wsEventDal: context.routeDeps.wsEventDal,
      ws: createClusterWsRouteOptions(context),
    }),
  );

  context.app.route(
    "/",
    createIngressRoutes({
      telegramRuntime,
      googleChatRuntime,
      telegramQueue:
        context.channelPipelineEnabled && context.opts.agents
          ? new TelegramChannelQueue(context.container.db, {
              conversationDal: context.container.conversationDal,
              logger: context.container.logger,
              ws: createWsRouteOptions(context),
            })
          : undefined,
      agents: context.opts.agents,
      identityScopeDal: context.container.identityScopeDal,
      artifactStore: context.container.artifactStore,
      artifactMaxUploadBytes: context.container.deploymentConfig.attachments.maxUploadBytes,
      memoryDal: context.container.memoryDal,
      routingConfigDal: context.routeDeps.routingConfigDal,
      logger: context.container.logger,
    }),
  );

  context.app.route("/", createMemoryRoutes({ memoryDal: context.container.memoryDal }));

  context.app.route(
    "/",
    createAgentsRoutes({
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
      stateMode: resolveGatewayStateMode(context.container.deploymentConfig),
      logger: context.container.logger,
      pluginCatalogProvider: context.opts.pluginCatalogProvider,
      plugins: context.opts.plugins,
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
  context.app.route(
    "/",
    createPolicyConfigRoutes({
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
      policyBundleDal: new PolicyBundleConfigDal(context.container.db),
    }),
  );
  if (isSharedStateMode(context.container.deploymentConfig)) {
    context.app.route(
      "/",
      createGatewayConfigRoutes({
        hooksDal: new LifecycleHookConfigDal(context.container.db),
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
        identityScopeDal: context.container.identityScopeDal,
      }),
    );
  }
}
