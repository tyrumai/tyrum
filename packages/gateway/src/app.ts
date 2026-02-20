/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import type { GatewayContainer } from "./container.js";
import { createHealthRoute } from "./routes/health.js";
import { policy } from "./routes/policy.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createModelProxyRoutes } from "./routes/model-proxy.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createApprovalRoutes } from "./routes/approval.js";
import { createWatcherRoutes } from "./routes/watcher.js";
import { createCanvasRoutes } from "./routes/canvas.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createSecretRoutes } from "./routes/secret.js";
import { createPlaybookRoutes } from "./routes/playbook.js";
import { createConnectionsRoute } from "./routes/connections.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { createWebApiRoutes } from "./routes/web-api.js";
import { createWebUiRoutes } from "./routes/web-ui.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import type { Playbook } from "@tyrum/schemas";
import type { AgentRuntime } from "./modules/agent/runtime.js";
import type { TokenStore } from "./modules/auth/token-store.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import { createAuthMiddleware } from "./modules/auth/middleware.js";
import type { ConnectionManager } from "./ws/connection-manager.js";
import { randomUUID } from "node:crypto";

export interface AppOptions {
  agentRuntime?: AgentRuntime;
  tokenStore?: TokenStore;
  secretProvider?: SecretProvider;
  playbooks?: Playbook[];
  isLocalOnly?: boolean;
  connectionManager?: ConnectionManager;
}

export function createApp(container: GatewayContainer, opts: AppOptions = {}): Hono {
  const app = new Hono();
  const isLocalOnly = opts.isLocalOnly ?? true;

  // Apply auth middleware if a token store is provided
  if (opts.tokenStore) {
    app.use("*", createAuthMiddleware(opts.tokenStore));
  }

  // Baseline structured request logging with stable request_id.
  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const requestId =
      c.req.header("x-request-id")?.trim() || `req-${randomUUID()}`;
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

  // Register all routes
  app.route("/", createHealthRoute({ isLocalOnly }));
  app.route("/", policy);
  app.route("/", createMemoryRoutes(container.memoryDal));
  app.route(
    "/",
    createIngressRoutes({
      telegramBot: container.telegramBot,
      agentRuntime: opts.agentRuntime,
    }),
  );
  app.route("/", createPlanRoutes(container));
  app.route("/", createApprovalRoutes(container.approvalDal));
  app.route("/", createWatcherRoutes(container.watcherProcessor));
  app.route("/", createCanvasRoutes(container.canvasDal));
  app.route("/", createAuditRoutes({ db: container.db, eventLog: container.eventLog }));

  // Playbook routes — load from TYRUM_HOME/playbooks or use pre-loaded set
  const tyrumHome = process.env["TYRUM_HOME"];
  const playbooks = opts.playbooks ?? (tyrumHome ? loadAllPlaybooks(`${tyrumHome}/playbooks`) : []);
  const playbookRunner = new PlaybookRunner();
  app.route("/", createPlaybookRoutes({ playbooks, runner: playbookRunner }));

  // Gateway-hosted web API compatibility layer for former Next handlers.
  app.route("/", createWebApiRoutes());

  if (opts.secretProvider) {
    app.route("/", createSecretRoutes(opts.secretProvider));
  }

  if (opts.connectionManager) {
    app.route("/", createConnectionsRoute(opts.connectionManager));
  }

  if (opts.agentRuntime) {
    app.route("/", createAgentRoutes(opts.agentRuntime));
  }

  // Model proxy routes are optional — only register if config path is set
  if (container.config?.modelGatewayConfigPath) {
    try {
      const modelProxy = createModelProxyRoutes(
        container.config.modelGatewayConfigPath,
      );
      app.route("/", modelProxy);
    } catch {
      // Model gateway config not available; skip registration
      console.warn(
        "Model gateway config not available; model proxy routes not registered",
      );
    }
  }

  // Gateway-hosted web UI.
  app.route(
    "/",
    createWebUiRoutes({
      approvalDal: container.approvalDal,
      memoryDal: container.memoryDal,
      watcherProcessor: container.watcherProcessor,
      canvasDal: container.canvasDal,
      playbooks,
      playbookRunner,
      isLocalOnly,
    }),
  );

  return app;
}
