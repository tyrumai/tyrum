/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { AgentRuntime } from "./modules/agent/runtime.js";

export const VERSION = "0.1.0";

// Re-export for library consumers
export { createContainer } from "./container.js";
export type { GatewayConfig, GatewayContainer } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const port = parseInt(process.env["GATEWAY_PORT"] ?? "8080", 10);
  const host = process.env["GATEWAY_HOST"]?.trim() || "127.0.0.1";
  const dbPath = process.env["GATEWAY_DB_PATH"] ?? "gateway.db";
  const migrationsDir =
    process.env["GATEWAY_MIGRATIONS_DIR"] ?? join(__dirname, "../migrations");
  const modelGatewayConfigPath =
    process.env["MODEL_GATEWAY_CONFIG"] ?? undefined;

  const container = createContainer({
    dbPath,
    migrationsDir,
    modelGatewayConfigPath,
  });

  const agentEnabled = process.env["TYRUM_AGENT_ENABLED"] === "1";
  const agentRuntime = agentEnabled ? new AgentRuntime({ container }) : undefined;
  const app = createApp(container, { agentRuntime });

  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(host)) {
    console.warn(
      "Gateway is configured to bind to a non-local interface without app authentication enabled.",
    );
  }

  console.log(`Gateway v${VERSION} listening on http://${host}:${port}`);
  const server = serve({ fetch: app.fetch, port, hostname: host });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Gateway shutting down (${signal})`);

    const hardExitTimer = setTimeout(() => {
      console.warn("Gateway forced shutdown after 5 seconds.");
      process.exit(1);
    }, 5_000);
    hardExitTimer.unref();

    const closeServer = new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });

    Promise.allSettled([
      closeServer,
      agentRuntime?.shutdown() ?? Promise.resolve(),
    ])
      .finally(() => {
        clearTimeout(hardExitTimer);
        try {
          container.db.close();
        } catch {
          // ignore
        }
        process.exit(0);
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// Run when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.mjs") ||
    process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("/index.ts"));

if (isMain) {
  main();
}
