/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { GatewayContainer } from "./container.js";
import { createHealthRoute } from "./routes/health.js";
import { createStatusRoutes } from "./routes/status.js";
import { createUsageRoutes } from "./routes/usage.js";
import { policy } from "./routes/policy.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createMemoryExportRoutes } from "./routes/memory-export.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createRoutingConfigRoutes } from "./routes/routing-config.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createAgentRoutes } from "./routes/agent.js";
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
import { createContractRoutes } from "./routes/contracts.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { createOperatorUiRoutes } from "./routes/operator-ui.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { ExecutionEngine } from "./modules/execution/engine.js";
import { isChannelPipelineEnabled, TelegramChannelQueue } from "./modules/channels/telegram.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import type { Playbook } from "@tyrum/schemas";
import type { AgentRegistry } from "./modules/agent/registry.js";
import type { TokenStore } from "./modules/auth/token-store.js";
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
  tokenStore?: TokenStore;
  secretProvider?: SecretProvider;
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
    instanceId: process.env["TYRUM_INSTANCE_ID"]?.trim() || "unknown",
    role: process.env["TYRUM_ROLE"]?.trim() || "all",
    otelEnabled: false,
  };

  const engine =
    opts.engine ??
    (() => {
      const engineApiEnabledRaw = process.env["TYRUM_ENGINE_API_ENABLED"]?.trim();
      const engineApiEnabled =
        engineApiEnabledRaw &&
        !["0", "false", "off", "no"].includes(engineApiEnabledRaw.toLowerCase());
      if (!engineApiEnabled) return undefined;
      return new ExecutionEngine({
        db: container.db,
        redactionEngine: container.redactionEngine,
        secretProvider: opts.secretProvider,
        policyService: container.policyService,
        logger: container.logger,
      });
    })();

  const authProfileDal = new AuthProfileDal(container.db);
  const pinDal = new SessionProviderPinDal(container.db);
  const routingConfigDal = new RoutingConfigDal(container.db);

  const secretProviderForAgent = (() => {
    if (!opts.secretProvider) return undefined;
    const defaultSecretProvider = opts.secretProvider;
    return async (agentId: string) => {
      if (opts.agents) {
        return await opts.agents.getSecretProvider(agentId);
      }
      return defaultSecretProvider;
    };
  })();

  const oauthSecretProviderForAgent = (() => {
    if (!opts.secretProvider) return undefined;
    const defaultSecretProvider = opts.secretProvider;
    return async (agentId: string) => {
      if (opts.agents) {
        return await opts.agents.getSecretProvider(agentId);
      }
      const trimmed = agentId.trim();
      if (trimmed !== "default") {
        throw new Error("non-default agent_id requires TYRUM_AGENT_ENABLED=1");
      }
      return defaultSecretProvider;
    };
  })();

  const trustedProxies = createTrustedProxyAllowlistFromEnv(process.env["GATEWAY_TRUSTED_PROXIES"]);
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

  // Apply auth middleware if a token store is provided
  if (opts.authRateLimiter) {
    const rateLimit = createRateLimitMiddleware(opts.authRateLimiter, { prefix: "auth" });
    app.use("/auth/session", rateLimit);
    app.use("/auth/logout", rateLimit);
    app.use("/auth/device-tokens/*", rateLimit);
  }

  if (opts.tokenStore) {
    const authAudit = new AuthAudit({
      eventLog: container.eventLog,
      logger: container.logger,
    });
    app.use("*", createAuthMiddleware(opts.tokenStore, { audit: authAudit }));
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
      nodePairingDal: container.nodePairingDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
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
      agents: opts.agents,
      logger: container.logger,
    }),
  );
  app.route("/", policy);
  app.route(
    "/",
    createPolicyBundleRoutes({
      policyService: container.policyService,
      policyOverrideDal: container.policyOverrideDal,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            cluster: opts.wsCluster,
          }
        : undefined,
    }),
  );
  if (opts.tokenStore) {
    app.route("/", createAuthSessionRoutes({ tokenStore: opts.tokenStore }));
  }
  app.route("/", createAuthProfileRoutes({ authProfileDal, pinDal }));
  if (opts.tokenStore) {
    app.route("/", createDeviceTokenRoutes({ tokenStore: opts.tokenStore }));
  }
  app.route("/", createModelsDevRoutes({ modelsDev: container.modelsDev }));
  if (oauthSecretProviderForAgent && isAuthProfilesEnabled()) {
    app.route(
      "/",
      createProviderOAuthRoutes({
        oauthPendingDal: container.oauthPendingDal,
        oauthProviderRegistry: container.oauthProviderRegistry,
        authProfileDal,
        secretProviderForAgent: oauthSecretProviderForAgent,
        logger: container.logger,
      }),
    );
  }
  if (opts.plugins) {
    app.route("/", createPluginRoutes({ plugins: opts.plugins }));
  }
  app.route("/", createMemoryRoutes(container.memoryDal));
  app.route("/", createMemoryExportRoutes({ artifactStore: container.artifactStore }));
  app.route(
    "/",
    createIngressRoutes({
      telegramBot: container.telegramBot,
      telegramQueue:
        isChannelPipelineEnabled() && container.telegramBot && opts.agents
          ? new TelegramChannelQueue(container.db, {
              ws: opts.connectionManager
                ? {
                    connectionManager: opts.connectionManager,
                    cluster: opts.wsCluster,
                  }
                : undefined,
            })
          : undefined,
      agents: opts.agents,
      memoryDal: container.memoryDal,
      routingConfigDal,
      home: container.config?.tyrumHome,
    }),
  );
  if (opts.tokenStore) {
    app.route(
      "/",
      createRoutingConfigRoutes({
        routingConfigDal,
        ws: opts.connectionManager
          ? {
              connectionManager: opts.connectionManager,
              cluster: opts.wsCluster,
            }
          : undefined,
      }),
    );
  }
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
      policyOverrideDal: container.policyOverrideDal,
      engine,
      ws: opts.connectionManager
        ? {
            connectionManager: opts.connectionManager,
            cluster: opts.wsCluster,
          }
        : undefined,
    }),
  );
  app.route(
    "/",
    createWatcherRoutes(container.watcherProcessor, {
      secretProviderForAgent,
    }),
  );
  app.route("/", createCanvasRoutes(container.canvasDal));
  app.route("/", createAuditRoutes({ db: container.db, eventLog: container.eventLog }));
  app.route("/", createSnapshotRoutes({ db: container.db, version: runtime.version }));
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

  // Playbook routes — load from TYRUM_HOME/playbooks or use pre-loaded set
  const tyrumHome = process.env["TYRUM_HOME"];
  const playbooks = opts.playbooks ?? (tyrumHome ? loadAllPlaybooks(`${tyrumHome}/playbooks`) : []);
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
  app.route("/", createOperatorUiRoutes());

  if (secretProviderForAgent) {
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent,
        authProfileDal,
        logger: container.logger,
      }),
    );
  }

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
      container.config.logStackTraces ?? process.env["NODE_ENV"] !== "production";
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
