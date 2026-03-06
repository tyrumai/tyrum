/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { GatewayContainer } from "./container.js";
import { createHealthRoute } from "./routes/health.js";
import { createStatusRoutes } from "./routes/status.js";
import { createUsageRoutes } from "./routes/usage.js";
import { policy } from "./routes/policy.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createMemoryExportRoutes } from "./routes/memory-export.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createRoutingConfigRoutes } from "./routes/routing-config.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createAgentConfigRoutes } from "./routes/agent-config.js";
import { createContextRoutes } from "./routes/context.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { createApprovalRoutes } from "./routes/approval.js";
import { createWatcherRoutes } from "./routes/watcher.js";
import { createCanvasRoutes } from "./routes/canvas.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createSecretRoutes } from "./routes/secret.js";
import { createArtifactRoutes } from "./routes/artifact.js";
import { createSnapshotRoutes } from "./routes/snapshot.js";
import { createPlaybookRoutes } from "./routes/playbook.js";
import { createConnectionsRoute } from "./routes/connections.js";
import { createPairingRoutes } from "./routes/pairing.js";
import { createAuthProfileRoutes } from "./routes/auth-profiles.js";
import { createAuthSessionRoutes } from "./routes/auth-session.js";
import { createDeviceTokenRoutes } from "./routes/device-token.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { createModelsDevRoutes } from "./routes/models-dev.js";
import { createProviderOAuthRoutes } from "./routes/provider-oauth.js";
import { createProviderConfigRoutes } from "./routes/provider-config.js";
import { createModelConfigRoutes } from "./routes/model-config.js";
import { createContractRoutes } from "./routes/contracts.js";
import { createSystemRoutes } from "./routes/system.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { createOperatorUiRoutes } from "./routes/operator-ui.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { ExecutionEngine } from "./modules/execution/engine.js";
import { TelegramChannelQueue } from "./modules/channels/telegram.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { WsEventDal } from "./modules/ws-event/dal.js";
import type { Playbook } from "@tyrum/schemas";
import type { AgentRegistry } from "./modules/agent/registry.js";
import type { AuthTokenService } from "./modules/auth/auth-token-service.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import type { PluginRegistry } from "./modules/plugins/registry.js";
import { createAuthMiddleware } from "./modules/auth/middleware.js";
import type { ConnectionManager } from "./ws/connection-manager.js";
import type { ConnectionDirectoryDal } from "./modules/backplane/connection-directory.js";
import type { OutboxDal } from "./modules/backplane/outbox-dal.js";
import { createHttpScopeAuthorizationMiddleware } from "./modules/authz/http-scope-middleware.js";
import { randomUUID } from "node:crypto";
import { VERSION } from "./version.js";
import { isAuthProfilesEnabled } from "./modules/models/auth-profiles-enabled.js";
import {
  createClientIpMiddleware,
  createTrustedProxyAllowlistFromEnv,
} from "./modules/auth/client-ip.js";
import { AuthAudit } from "./modules/auth/audit.js";
import {
  createRateLimitMiddleware,
  type SlidingWindowRateLimiter,
} from "./modules/auth/rate-limiter.js";
import { createMetricsMiddleware, gatewayMetrics } from "./modules/observability/metrics.js";
import { requestIdForAudit } from "./modules/observability/request-id.js";

export interface AppOptions {
  agents?: AgentRegistry;
  plugins?: PluginRegistry;
  authTokens?: AuthTokenService;
  secretProviderForTenant?: (tenantId: string) => SecretProvider;
  playbooks?: Playbook[];
  isLocalOnly?: boolean;
  connectionManager?: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  engine?: ExecutionEngine;
  wsCluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
  };
  authRateLimiter?: SlidingWindowRateLimiter;
  operatorUiAssetsDir?: string;
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    otelEnabled: boolean;
  };
}

export function createApp(container: GatewayContainer, opts: AppOptions = {}): Hono {
  const app = new Hono();
  const isLocalOnly = opts.isLocalOnly ?? true;
  const runtime = opts.runtime ?? {
    version: VERSION,
    instanceId: "unknown",
    role: "all",
    otelEnabled: container.deploymentConfig.otel.enabled ?? false,
  };

  const engine =
    opts.engine ??
    (() => {
      const engineApiEnabled = container.deploymentConfig.execution.engineApiEnabled ?? false;
      if (!engineApiEnabled) return undefined;
      return new ExecutionEngine({
        db: container.db,
        redactionEngine: container.redactionEngine,
        secretProviderForTenant: opts.secretProviderForTenant,
        policyService: container.policyService,
        logger: container.logger,
      });
    })();

  const authProfileDal = new AuthProfileDal(container.db);
  const pinDal = new SessionProviderPinDal(container.db);
  const configuredModelPresetDal = new ConfiguredModelPresetDal(container.db);
  const executionProfileModelAssignmentDal = new ExecutionProfileModelAssignmentDal(container.db);
  const routingConfigDal = new RoutingConfigDal(container.db);
  const wsEventDal = new WsEventDal(container.db);

  const secretProviderForTenant = opts.secretProviderForTenant;

  const trustedProxies = createTrustedProxyAllowlistFromEnv(
    container.deploymentConfig.server.trustedProxies,
  );
  app.use("*", createClientIpMiddleware({ trustedProxies }));

  // Baseline structured request logging with stable request_id.
  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const requestId = c.req.header("x-request-id")?.trim() || `req-${randomUUID()}`;
    c.header("x-request-id", requestId);

    container.logger.debug("http.request", {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
    });

    try {
      await next();
    } finally {
      container.logger.debug("http.response", {
        request_id: requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.max(0, Date.now() - startedAt),
      });
    }
  });

  // Prometheus request metrics.
  app.use("*", createMetricsMiddleware(gatewayMetrics));

  const corsOrigins = container.deploymentConfig.server.corsOrigins ?? [];

  if (corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: corsOrigins,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: 3600,
      }),
    );
  }

  const channelPipelineEnabled = container.deploymentConfig.channels.pipelineEnabled ?? true;
  const wsMaxBufferedBytes = container.deploymentConfig.websocket.maxBufferedBytes;

  // Apply auth middleware if a token store is provided
  if (opts.authRateLimiter) {
    const rateLimit = createRateLimitMiddleware(opts.authRateLimiter, { prefix: "auth" });
    app.use("/auth/session", rateLimit);
    app.use("/auth/logout", rateLimit);
    app.use("/auth/device-tokens/issue", rateLimit);
    app.use("/auth/device-tokens/revoke", rateLimit);
  }

  if (opts.authTokens) {
    const authAudit = new AuthAudit({
      eventLog: container.eventLog,
      logger: container.logger,
    });
    app.use(
      "*",
      createAuthMiddleware(opts.authTokens, { audit: authAudit, logger: container.logger }),
    );
    app.use("*", createHttpScopeAuthorizationMiddleware({ audit: authAudit }));
  }

  // Register all routes
  app.route("/", createHealthRoute({ isLocalOnly }));
  app.route("/", createMetricsRoutes({ registry: gatewayMetrics }));
  app.route(
    "/",
    createStatusRoutes({
      version: runtime.version,
      instanceId: runtime.instanceId,
      role: runtime.role,
      dbKind: container.db.kind,
      db: container.db,
      isLocalOnly,
      otelEnabled: runtime.otelEnabled,
      connectionManager: opts.connectionManager,
      policyService: container.policyService,
      modelsDev: container.modelsDev,
      agents: opts.agents,
    }),
  );
  app.route("/", createContractRoutes());
  app.route(
    "/",
    createPresenceRoutes({
      instanceId: runtime.instanceId,
      version: runtime.version,
      role: runtime.role,
      presenceDal: container.presenceDal,
    }),
  );
  app.route(
    "/",
    createPairingRoutes({
      logger: container.logger,
      nodePairingDal: container.nodePairingDal,
      wsEventDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            maxBufferedBytes: wsMaxBufferedBytes,
            cluster:
              opts.wsCluster && opts.connectionDirectory
                ? { ...opts.wsCluster, connectionDirectory: opts.connectionDirectory }
                : undefined,
          }
        : undefined,
    }),
  );
  app.route(
    "/",
    createUsageRoutes({
      db: container.db,
      authProfileDal,
      pinDal,
      secretProviderForTenant,
      logger: container.logger,
    }),
  );
  app.route("/", policy);
  app.route(
    "/",
    createPolicyBundleRoutes({
      logger: container.logger,
      policyService: container.policyService,
      policyOverrideDal: container.policyOverrideDal,
      wsEventDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            cluster: opts.wsCluster,
            maxBufferedBytes: wsMaxBufferedBytes,
          }
        : undefined,
    }),
  );
  if (opts.authTokens) {
    app.route("/", createAuthSessionRoutes({ authTokens: opts.authTokens }));
  }
  if (opts.authTokens) {
    app.route("/", createDeviceTokenRoutes({ authTokens: opts.authTokens }));
  }
  if (opts.authTokens) {
    app.route(
      "/",
      createSystemRoutes({
        db: container.db,
        authTokens: opts.authTokens,
      }),
    );
  }
  app.route("/", createAuthProfileRoutes({ authProfileDal, pinDal }));
  app.route(
    "/",
    createModelsDevRoutes({ modelsDev: container.modelsDev, modelCatalog: container.modelCatalog }),
  );
  if (secretProviderForTenant) {
    app.route(
      "/",
      createProviderConfigRoutes({
        db: container.db,
        authProfileDal,
        modelCatalog: container.modelCatalog,
        secretProviderForTenant,
        configuredModelPresetDal,
        executionProfileModelAssignmentDal,
      }),
    );
  }
  app.route(
    "/",
    createModelConfigRoutes({
      db: container.db,
      modelCatalog: container.modelCatalog,
      authProfileDal,
      configuredModelPresetDal,
      executionProfileModelAssignmentDal,
    }),
  );
  if (secretProviderForTenant && isAuthProfilesEnabled()) {
    app.route(
      "/",
      createProviderOAuthRoutes({
        oauthPendingDal: container.oauthPendingDal,
        oauthProviderRegistry: container.oauthProviderRegistry,
        authProfileDal,
        secretProviderForTenant,
        logger: container.logger,
      }),
    );
  }
  if (opts.plugins) {
    app.route("/", createPluginRoutes({ plugins: opts.plugins }));
  }
  app.route("/", createMemoryExportRoutes({ artifactStore: container.artifactStore }));
  app.route(
    "/",
    createIngressRoutes({
      telegramBot: container.telegramBot,
      telegramWebhookSecret: container.deploymentConfig.channels.telegramWebhookSecret,
      telegramQueue:
        channelPipelineEnabled && container.telegramBot && opts.agents
          ? new TelegramChannelQueue(container.db, {
              sessionDal: container.sessionDal,
              logger: container.logger,
              ws: opts.connectionManager
                ? {
                    connectionManager: opts.connectionManager,
                    cluster: opts.wsCluster,
                    maxBufferedBytes: wsMaxBufferedBytes,
                  }
                : undefined,
            })
          : undefined,
      agents: opts.agents,
      memoryV1Dal: container.memoryV1Dal,
      routingConfigDal,
      logger: container.logger,
      home: container.config?.tyrumHome,
    }),
  );
  app.route(
    "/",
    createRoutingConfigRoutes({
      logger: container.logger,
      routingConfigDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            cluster: opts.wsCluster,
            maxBufferedBytes: wsMaxBufferedBytes,
          }
        : undefined,
    }),
  );
  app.route("/", createPlanRoutes(container));
  if (engine) {
    app.route(
      "/",
      createWorkflowRoutes({ engine, policyService: container.policyService, agents: opts.agents }),
    );
  }
  app.route(
    "/",
    createApprovalRoutes({
      approvalDal: container.approvalDal,
      logger: container.logger,
      policyOverrideDal: container.policyOverrideDal,
      wsEventDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            maxBufferedBytes: wsMaxBufferedBytes,
            cluster: opts.wsCluster,
          }
        : undefined,
    }),
  );
  app.route(
    "/",
    createWatcherRoutes(container.watcherProcessor, {
      secretProviderForTenant,
    }),
  );
  app.route(
    "/",
    createCanvasRoutes({
      canvasDal: container.canvasDal,
      identityScopeDal: container.identityScopeDal,
    }),
  );
  app.route(
    "/",
    createAuditRoutes({
      db: container.db,
      eventLog: container.eventLog,
      identityScopeDal: container.identityScopeDal,
    }),
  );
  app.route(
    "/",
    createSnapshotRoutes({
      db: container.db,
      version: runtime.version,
      importEnabled: container.deploymentConfig.snapshots.importEnabled,
    }),
  );
  app.route(
    "/",
    createArtifactRoutes({
      db: container.db,
      artifactStore: container.artifactStore,
      logger: container.logger,
      policySnapshotDal: container.policySnapshotDal,
      policyService: container.policyService,
    }),
  );

  // Playbook routes — load from home/playbooks or use pre-loaded set
  const playbookHome = container.config?.tyrumHome;
  const playbooks =
    opts.playbooks ?? (playbookHome ? loadAllPlaybooks(`${playbookHome}/playbooks`) : []);
  const playbookRunner = new PlaybookRunner();
  app.route(
    "/",
    createPlaybookRoutes({
      playbooks,
      runner: playbookRunner,
      engine,
      policyService: container.policyService,
      approvalDal: container.approvalDal,
      db: container.db,
    }),
  );

  // Operator web UI (static SPA).
  app.route("/", createOperatorUiRoutes({ assetsDir: opts.operatorUiAssetsDir }));

  if (secretProviderForTenant) {
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForTenant,
      }),
    );
  }

  app.route(
    "/",
    createAgentConfigRoutes({
      db: container.db,
      identityScopeDal: container.identityScopeDal,
    }),
  );

  if (opts.connectionManager) {
    app.route("/", createConnectionsRoute(opts.connectionManager));
  }

  if (opts.agents) {
    app.route("/", createAgentRoutes(opts.agents));
    app.route(
      "/",
      createContextRoutes({
        agents: opts.agents,
        contextReportDal: container.contextReportDal,
      }),
    );
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    const requestId = requestIdForAudit(c);
    const payload: Record<string, unknown> = {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      error_name: err.name,
      error_message: err.message,
    };
    const shouldIncludeStackTrace =
      container.config.logStackTraces ??
      (process.env["NODE_ENV"] ?? "development") !== "production";
    if (shouldIncludeStackTrace && err.stack) {
      payload["error_stack"] = err.stack;
    }

    // Note: Do not treat raw ZodErrors as invalid_request.
    // Zod is used to parse server-side data (DB rows/response shapes) and those failures should surface as 500s.
    const errCode = (err as { code?: unknown }).code;
    if (err.name === "InvalidRequestError" || errCode === "invalid_request") {
      container.logger.warn("http.invalid_request", payload);
      return c.json({ error: "invalid_request", message: err.message }, 400);
    }

    container.logger.error("http.unhandled_error", payload);
    return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found", message: "route not found" }, 404));

  return app;
}
