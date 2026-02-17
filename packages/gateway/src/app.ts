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

export function createApp(container: GatewayContainer): Hono {
  const app = new Hono();

  // Register all routes
  app.route("/", health);
  app.route("/", policy);
  app.route("/", createMemoryRoutes(container.memoryDal));
  app.route("/", ingress);
  app.route("/", createPlanRoutes(container));

  if (process.env["TYRUM_AGENT_ENABLED"] === "1") {
    app.route("/", createAgentRoutes(container));
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
