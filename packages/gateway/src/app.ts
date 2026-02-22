/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import type { GatewayContainer } from "./container.js";
import { createHealthRoute } from "./routes/health.js";
import { createStatusRoutes } from "./routes/status.js";
import { createUsageRoutes } from "./routes/usage.js";
import { policy } from "./routes/policy.js";
import { createPolicyBundleRoutes } from "./routes/policy-bundle.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createIngressRoutes } from "./routes/ingress.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createModelProxyRoutes } from "./routes/model-proxy.js";
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
import { createPluginRoutes } from "./routes/plugins.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { createWebApiRoutes } from "./routes/web-api.js";
import { createWebUiRoutes } from "./routes/web-ui.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { ExecutionEngine } from "./modules/execution/engine.js";
import { isChannelPipelineEnabled, TelegramChannelQueue } from "./modules/channels/telegram.js";
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
import { randomUUID } from "node:crypto";
import { VERSION } from "./version.js";

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
        logger: container.logger,
      });
    })();

  const authProfileDal = new AuthProfileDal(container.db);
  const pinDal = new SessionProviderPinDal(container.db);

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
  app.route(
    "/",
    createStatusRoutes({
      version: runtime.version,
      instanceId: runtime.instanceId,
      role: runtime.role,
      dbKind: container.db.kind,
      isLocalOnly,
      otelEnabled: runtime.otelEnabled,
      connectionManager: opts.connectionManager,
      policyService: container.policyService,
      modelGatewayConfigPath: container.config?.modelGatewayConfigPath,
      authProfileDal,
      pinDal,
    }),
  );
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
            cluster: opts.wsCluster,
          }
        : undefined,
    }),
  );
  app.route("/", createUsageRoutes({ db: container.db }));
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
  app.route("/", createAuthProfileRoutes({ authProfileDal, pinDal }));
  if (opts.plugins) {
    app.route("/", createPluginRoutes({ plugins: opts.plugins }));
  }
  app.route("/", createMemoryRoutes(container.memoryDal));
  app.route(
    "/",
    createIngressRoutes({
      telegramBot: container.telegramBot,
      telegramQueue:
        isChannelPipelineEnabled() && container.telegramBot && opts.agents
          ? new TelegramChannelQueue(container.db)
          : undefined,
      agents: opts.agents,
      home: container.config?.tyrumHome,
    }),
  );
  app.route("/", createPlanRoutes(container));
  if (engine) {
    app.route("/", createWorkflowRoutes({ engine, policyService: container.policyService, agents: opts.agents }));
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
  app.route("/", createWatcherRoutes(container.watcherProcessor));
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
    }),
  );

  // Gateway-hosted web API compatibility layer for former Next handlers.
  app.route("/", createWebApiRoutes());

  if (secretProviderForAgent) {
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent,
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

  // Model proxy routes are optional — only register if config path is set
  if (container.config?.modelGatewayConfigPath) {
    try {
      const modelProxyDeps = secretProviderForAgent
        ? {
          auth: {
            authProfileDal,
            pinDal,
            secretProviderForAgent,
            logger: container.logger,
            wsCluster: opts.wsCluster,
          },
        }
        : undefined;

      const modelProxy = createModelProxyRoutes(
        container.config.modelGatewayConfigPath,
        modelProxyDeps,
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
