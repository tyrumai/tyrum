/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { GatewayContainer } from "./container.js";
import { ExecutionEngine } from "./modules/execution/engine.js";
import type { Playbook } from "@tyrum/schemas";
import type { AgentRegistry } from "./modules/agent/registry.js";
import type { AuthTokenService } from "./modules/auth/auth-token-service.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import type { PluginRegistry } from "./modules/plugins/registry.js";
import type { PluginCatalogProvider } from "./modules/plugins/catalog-provider.js";
import { createAuthMiddleware } from "./modules/auth/middleware.js";
import type { ConnectionManager } from "./ws/connection-manager.js";
import type { ProtocolDeps } from "./ws/protocol.js";
import type { ConnectionDirectoryDal } from "./modules/backplane/connection-directory.js";
import type { OutboxDal } from "./modules/backplane/outbox-dal.js";
import { createHttpScopeAuthorizationMiddleware } from "./modules/authz/http-scope-middleware.js";
import { randomUUID } from "node:crypto";
import { VERSION } from "./version.js";
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
import type { TelegramChannelRuntime } from "./modules/channels/telegram-runtime.js";
import {
  createAppRouteDependencies,
  registerAgentsAndWorkspaceRoutes,
  registerArtifactsAuditAndUiRoutes,
  registerAuthAndSecurityRoutes,
  registerExecutionAndWorkflowRoutes,
  registerModelsAndConfigRoutes,
  registerSystemAndPublicRoutes,
} from "./app-route-registrars.js";

export interface AppOptions {
  agents?: AgentRegistry;
  telegramRuntime?: TelegramChannelRuntime;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  authTokens?: AuthTokenService;
  secretProviderForTenant?: (tenantId: string) => SecretProvider;
  playbooks?: Playbook[];
  isLocalOnly?: boolean;
  connectionManager?: ConnectionManager;
  protocolDeps?: ProtocolDeps;
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

  const secretProviderForTenant = opts.secretProviderForTenant;
  const routeDeps = createAppRouteDependencies(container);

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

  const routeContext = {
    app,
    container,
    opts,
    runtime,
    isLocalOnly,
    wsMaxBufferedBytes,
    engine,
    secretProviderForTenant,
    routeDeps,
  } as const;

  registerSystemAndPublicRoutes(routeContext);
  registerAuthAndSecurityRoutes(routeContext);
  registerModelsAndConfigRoutes(routeContext);
  registerExecutionAndWorkflowRoutes(routeContext);
  registerAgentsAndWorkspaceRoutes(routeContext);
  registerArtifactsAuditAndUiRoutes(routeContext);

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
