/**
 * Hono app factory — creates and wires all routes.
 */

import { Hono } from "hono";
import type { GatewayContainer } from "./container.js";
import { health } from "./routes/health.js";
import { policy } from "./routes/policy.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { ingress } from "./routes/ingress.js";
import { createPlanRoutes } from "./routes/plan.js";
import { createModelProxyRoutes } from "./routes/model-proxy.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createConnectionsRoute } from "./routes/connections.js";
import type { AgentRuntime } from "./modules/agent/runtime.js";
import type { ConnectionManager } from "./ws/connection-manager.js";

export interface AppOptions {
  agentRuntime?: AgentRuntime;
  connectionManager?: ConnectionManager;
}

export function createApp(container: GatewayContainer, opts: AppOptions = {}): Hono {
  const app = new Hono();

  // Register all routes
  app.route("/", health);
  app.route("/", policy);
  app.route("/", createMemoryRoutes(container.memoryDal));
  app.route("/", ingress);
  app.route("/", createPlanRoutes(container));

  if (opts.connectionManager) {
    app.route("/", createConnectionsRoute(opts.connectionManager));
  }

  if (process.env["TYRUM_AGENT_ENABLED"] === "1") {
    if (!opts.agentRuntime) {
      throw new Error(
        "Agent routes require an explicit AgentRuntime when TYRUM_AGENT_ENABLED=1.",
      );
    }
    app.route("/", createAgentRoutes(opts.agentRuntime));
  }

  // Model proxy routes are optional — only register if config path is set
  if (container.config.modelGatewayConfigPath) {
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

  return app;
}
