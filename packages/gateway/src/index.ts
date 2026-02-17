/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { AgentRuntime } from "./modules/agent/runtime.js";
import { createWsHandler } from "./routes/ws.js";
import { ConnectionManager } from "./ws/connection-manager.js";

export const VERSION = "0.1.0";

// Re-export for library consumers
export { createContainer } from "./container.js";
export type { GatewayConfig, GatewayContainer } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";
export { createWsHandler } from "./routes/ws.js";
export type { WsRouteOptions } from "./routes/ws.js";
export { ConnectionManager } from "./ws/connection-manager.js";
export type { ConnectedClient, ConnectionStats } from "./ws/connection-manager.js";

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

  // --- WebSocket handler ---
  const connectionManager = new ConnectionManager();
  const { handleUpgrade, stopHeartbeat, wss } = createWsHandler({
    connectionManager,
    protocolDeps: { connectionManager },
  });

  // --- HTTP server with WS upgrade support ---
  const listener = getRequestListener(app.fetch);
  const server = createServer(listener);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, host, () => {
    console.log(`Gateway v${VERSION} listening on http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Gateway shutting down (${signal})`);

    stopHeartbeat();

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

    const closeWss = new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });

    Promise.allSettled([
      closeServer,
      closeWss,
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
