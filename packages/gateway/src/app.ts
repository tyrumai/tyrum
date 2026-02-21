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
import { createObservabilityRoutes } from "./routes/observability.js";
import { createPresenceRoutes } from "./routes/presence.js";
import { createArtifactRoutes } from "./routes/artifact.js";
import { createWorkflowRoutes } from "./routes/workflow.js";
import { createNodeRoutes } from "./routes/node.js";
import { createPolicyV2Routes } from "./routes/policy-v2.js";
import { createPolicyOverrideRoutes } from "./routes/policy-override.js";
import { createModelRoutes } from "./routes/model.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { createWebApiRoutes } from "./routes/web-api.js";
import { createWebUiRoutes } from "./routes/web-ui.js";
import { createSnapshotRoutes } from "./routes/snapshot.js";
import { createSchemaRoutes } from "./routes/schema.js";
import { createCatalogRoutes } from "./routes/catalog.js";
import { createPluginRoutes } from "./routes/plugin.js";
import { createSpaRoutes } from "./routes/spa.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import type { Playbook } from "@tyrum/schemas";
import type { AgentRuntime } from "./modules/agent/runtime.js";
import type { TokenStore } from "./modules/auth/token-store.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import { createAuthMiddleware } from "./modules/auth/middleware.js";
import type { ConnectionManager } from "./ws/connection-manager.js";
import type { EventPublisher } from "./modules/backplane/event-publisher.js";
import { DedupeDal } from "./modules/connector/dedupe-dal.js";
import { ConnectorPipeline } from "./modules/connector/pipeline.js";
import { randomUUID } from "node:crypto";

export interface AppOptions {
  agentRuntime?: AgentRuntime;
  tokenStore?: TokenStore;
  secretProvider?: SecretProvider;
  playbooks?: Playbook[];
  isLocalOnly?: boolean;
  connectionManager?: ConnectionManager;
  eventPublisher?: EventPublisher;
  version?: string;
  startedAt?: number;
  role?: string;
}

export function createApp(container: GatewayContainer, opts: AppOptions = {}): Hono {
  const app = new Hono();
  const isLocalOnly = opts.isLocalOnly ?? true;

  // Apply auth middleware if a token store is provided
  if (opts.tokenStore) {
    app.use("*", createAuthMiddleware(opts.tokenStore));
  }

  // Contract version header for schema compatibility tracking
  const CONTRACT_VERSION = "0.1.0";
  app.use("*", async (c, next) => {
    c.header("X-Tyrum-Contract-Version", CONTRACT_VERSION);
    await next();
  });

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
  const connectorPipelineEnabled = (() => {
    const raw = process.env["TYRUM_CONNECTOR_PIPELINE"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  const connectorPipeline = connectorPipelineEnabled
    ? new ConnectorPipeline({ dedupeDal: new DedupeDal(container.db) })
    : undefined;

  app.route(
    "/",
    createIngressRoutes({
      telegramBot: container.telegramBot,
      agentRuntime: opts.agentRuntime,
      connectorPipeline,
    }),
  );
  app.route("/", createPlanRoutes(container));
  app.route("/", createApprovalRoutes({
    approvalDal: container.approvalDal,
    eventBus: container.eventBus,
    policyOverrideDal: container.policyOverrideDal,
  }));
  app.route("/", createWatcherRoutes(container.watcherProcessor));
  app.route("/", createCanvasRoutes(container.canvasDal));
  app.route("/", createAuditRoutes({ db: container.db, eventLog: container.eventLog }));
  app.route("/", createArtifactRoutes({
    artifactMetadataDal: container.artifactMetadataDal,
    artifactStore: container.artifactStore,
    eventPublisher: opts.eventPublisher,
  }));

  // Playbook routes — load from TYRUM_HOME/playbooks or use pre-loaded set
  const tyrumHome = process.env["TYRUM_HOME"];
  const playbooks = opts.playbooks ?? (tyrumHome ? loadAllPlaybooks(`${tyrumHome}/playbooks`) : []);
  const playbookRunner = new PlaybookRunner();
  app.route("/", createPlaybookRoutes({ playbooks, runner: playbookRunner }));

  // Gateway-hosted web API compatibility layer for former Next handlers.
  app.route("/", createWebApiRoutes());

  if (opts.secretProvider) {
    app.route("/", createSecretRoutes({
      secretProvider: opts.secretProvider,
      eventPublisher: opts.eventPublisher,
    }));
  }

  if (opts.connectionManager) {
    app.route("/", createConnectionsRoute(opts.connectionManager));
  }

  const observabilityEnabled = (() => {
    const raw = process.env["TYRUM_OBSERVABILITY_ENDPOINTS"]?.trim().toLowerCase();
    if (!raw) return true;
    return !["0", "false", "off", "no"].includes(raw);
  })();

  if (observabilityEnabled) {
    app.route("/", createObservabilityRoutes({
      db: container.db,
      memoryDal: container.memoryDal,
      connectionManager: opts.connectionManager,
      contextReportDal: container.contextReportDal,
      version: opts.version ?? "unknown",
      startedAt: opts.startedAt ?? Date.now(),
      role: opts.role ?? "all",
    }));
  }

  app.route("/", createSnapshotRoutes({ db: container.db }));
  app.route("/", createSchemaRoutes());
  app.route("/", createCatalogRoutes({ modelCatalog: container.modelCatalog }));

  const presenceEnabled = (() => {
    const raw = process.env["TYRUM_PRESENCE"]?.trim().toLowerCase();
    if (!raw) return true; // default on
    return !["0", "false", "off", "no"].includes(raw);
  })();

  if (presenceEnabled) {
    app.route("/", createPresenceRoutes(container.presenceDal));
  }

  const workflowApiEnabled = (() => {
    const raw = process.env["TYRUM_WORKFLOW_API"]?.trim().toLowerCase();
    if (!raw) return true; // default on
    return !["0", "false", "off", "no"].includes(raw);
  })();

  if (workflowApiEnabled) {
    app.route("/", createWorkflowRoutes({ db: container.db, eventPublisher: opts.eventPublisher }));
  }

  const nodePairingEnabled = (() => {
    const raw = process.env["TYRUM_NODE_PAIRING"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  if (nodePairingEnabled) {
    app.route("/", createNodeRoutes({ nodeDal: container.nodeDal }));
  }

  const policyV2Enabled = (() => {
    const raw = process.env["TYRUM_POLICY_ENFORCE"]?.trim().toLowerCase();
    if (!raw) return false; // default off (observe-only)
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  if (policyV2Enabled) {
    app.route("/", createPolicyV2Routes({
      bundleManager: container.policyBundleManager,
      snapshotDal: container.policySnapshotDal,
    }));
  }

  // Policy override routes (always on — overrides are a core audit object)
  app.route("/", createPolicyOverrideRoutes({
    policyOverrideDal: container.policyOverrideDal,
    eventPublisher: opts.eventPublisher,
  }));

  const authProfilesEnabled = (() => {
    const raw = process.env["TYRUM_AUTH_PROFILES"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  if (authProfilesEnabled) {
    app.route("/", createModelRoutes({
      authProfileDal: container.authProfileDal,
      eventPublisher: opts.eventPublisher,
    }));
  }

  const pluginsEnabled = (() => {
    const raw = process.env["TYRUM_PLUGINS"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  if (pluginsEnabled) {
    app.route("/", createPluginRoutes({ pluginRegistry: container.pluginRegistry }));
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

  // Gateway-hosted web UI — SPA or server-rendered.
  const spaEnabled = (() => {
    const raw = process.env["TYRUM_SPA_UI"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  if (spaEnabled) {
    const distDir = process.env["TYRUM_SPA_DIST_DIR"]?.trim() || "";
    if (distDir) {
      app.route("/", createSpaRoutes({ distDir }));
    }
  }

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
