import type { Playbook } from "@tyrum/schemas";
import { Hono } from "hono";
import type { AppOptions } from "./app.js";
import type { GatewayContainer } from "./container.js";
import { createAgentConfigRoutes } from "./routes/agent-config.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createApprovalRoutes } from "./routes/approval.js";
import { createAutomationScheduleRoutes } from "./routes/automation-schedules.js";
import { createArtifactRoutes } from "./routes/artifact.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createAuthProfileRoutes } from "./routes/auth-profiles.js";
import { createAuthSessionRoutes } from "./routes/auth-session.js";
import { createCanvasRoutes } from "./routes/canvas.js";
import { createConnectionsRoute } from "./routes/connections.js";
import { createContextRoutes } from "./routes/context.js";
import { createContractRoutes } from "./routes/contracts.js";
import { createDeviceTokenRoutes } from "./routes/device-token.js";
import { createHealthRoute } from "./routes/health.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createMemoryExportRoutes } from "./routes/memory-export.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createModelConfigRoutes } from "./routes/model-config.js";
import { createModelsDevRoutes } from "./routes/models-dev.js";
import { createOperatorUiRoutes } from "./routes/operator-ui.js";
import { createPairingRoutes } from "./routes/pairing.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createPlaybookRoutes } from "./routes/playbook.js";
import { policy } from "./routes/policy.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createProviderConfigRoutes } from "./routes/provider-config.js";
import { createProviderOAuthRoutes } from "./routes/provider-oauth.js";
import { createRoutingConfigRoutes } from "./routes/routing-config.js";
import { createSecretRoutes } from "./routes/secret.js";
import { createSnapshotRoutes } from "./routes/snapshot.js";
import { createStatusRoutes } from "./routes/status.js";
import { createSystemRoutes } from "./routes/system.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createWatcherRoutes } from "./routes/watcher.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { TelegramChannelQueue } from "./modules/channels/telegram.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { WsEventDal } from "./modules/ws-event/dal.js";
import { isAuthProfilesEnabled } from "./modules/models/auth-profiles-enabled.js";
import { gatewayMetrics } from "./modules/observability/metrics.js";
import { isLocalStateMode } from "./modules/runtime-state/mode.js";

export interface AppRouteDependencies {
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
  routingConfigDal: RoutingConfigDal;
  wsEventDal: WsEventDal;
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
  };
  isLocalOnly: boolean;
  wsMaxBufferedBytes?: number;
  channelPipelineEnabled: boolean;
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
    context.app.route("/", createDeviceTokenRoutes({ authTokens: context.opts.authTokens }));
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
    context.app.route("/", createPluginRoutes({ plugins: context.opts.plugins }));
  }

  context.app.route(
    "/",
    createRoutingConfigRoutes({
      logger: context.container.logger,
      routingConfigDal: context.routeDeps.routingConfigDal,
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
      telegramBot: context.container.telegramBot,
      telegramWebhookSecret: context.container.deploymentConfig.channels.telegramWebhookSecret,
      telegramQueue:
        context.channelPipelineEnabled && context.container.telegramBot && context.opts.agents
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
      home: isLocalStateMode(context.container.deploymentConfig)
        ? context.container.config?.tyrumHome
        : undefined,
    }),
  );

  context.app.route(
    "/",
    createAgentConfigRoutes({
      db: context.container.db,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );

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
