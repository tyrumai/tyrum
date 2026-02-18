/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { AgentRuntime } from "./modules/agent/runtime.js";
import { TokenStore } from "./modules/auth/token-store.js";
import { WatcherScheduler } from "./modules/watcher/scheduler.js";
import { EnvSecretProvider, FileSecretProvider } from "./modules/secret/provider.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import { WsNotifier } from "./modules/approval/notifier.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { createWsHandler } from "./routes/ws.js";

export const VERSION = "0.1.0";

// Re-export for library consumers
export { createContainer } from "./container.js";
export type { GatewayConfig, GatewayContainer } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";
export { TokenStore } from "./modules/auth/token-store.js";
export { createWsHandler } from "./routes/ws.js";
export type { WsRouteOptions } from "./routes/ws.js";
export { ConnectionManager } from "./ws/connection-manager.js";
export type { ConnectedClient, ConnectionStats } from "./ws/connection-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

async function main(): Promise<void> {
  const port = parseInt(process.env["GATEWAY_PORT"] ?? "8080", 10);
  const host = process.env["GATEWAY_HOST"]?.trim() || "127.0.0.1";
  const dbPath = process.env["GATEWAY_DB_PATH"] ?? "gateway.db";
  const migrationsDir =
    process.env["GATEWAY_MIGRATIONS_DIR"] ?? join(__dirname, "../migrations");
  const modelGatewayConfigPath =
    process.env["MODEL_GATEWAY_CONFIG"] ?? undefined;

  const tyrumHome =
    process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  const isLocalOnly = LOCAL_HOSTS.has(host);

  const container = createContainer({
    dbPath,
    migrationsDir,
    modelGatewayConfigPath,
  });

  // Initialize auth token store
  const tokenStore = new TokenStore(tyrumHome);
  const token = await tokenStore.initialize();

  if (!isLocalOnly) {
    const tokenPath = join(tyrumHome, ".admin-token");
    console.log("---");
    console.log("Gateway is exposed on a non-local interface.");
    console.log(`Admin token stored at: ${tokenPath}`);
    console.log("Read it with: cat " + tokenPath);
    console.log("---");
  }

  // Initialize secret provider — use FileSecretProvider when token is available
  let secretProvider: SecretProvider;
  if (token) {
    const secretsPath = join(tyrumHome, "secrets.json");
    secretProvider = await FileSecretProvider.create(secretsPath, token);
  } else {
    secretProvider = new EnvSecretProvider();
  }

  if (container.telegramBot) {
    console.log("Telegram bot initialized");
  }

  // Start watcher processor (event bus subscriptions) and scheduler (periodic tick)
  container.watcherProcessor.start();
  const watcherScheduler = new WatcherScheduler({
    db: container.db,
    memoryDal: container.memoryDal,
    eventBus: container.eventBus,
  });
  watcherScheduler.start();
  console.log("Watcher processor and scheduler started");

  const connectionManager = new ConnectionManager();
  const protocolDeps = {
    connectionManager,
    onHumanResponse: (
      planId: string,
      approved: boolean,
      reason: string | undefined,
    ) => {
      const pendingApproval = container.approvalDal
        .getByPlanId(planId)
        .find((approval) => approval.status === "pending");
      if (!pendingApproval) {
        return;
      }
      container.approvalDal.respond(pendingApproval.id, approved, reason);
    },
  };
  const approvalNotifier = new WsNotifier(protocolDeps);

  const agentEnabled = process.env["TYRUM_AGENT_ENABLED"] === "1";
  const agentRuntime = agentEnabled
    ? new AgentRuntime({ container, secretProvider, approvalNotifier })
    : undefined;

  const app = createApp(container, {
    agentRuntime,
    tokenStore,
    secretProvider,
    isLocalOnly,
    connectionManager,
  });

  // --- WebSocket handler ---
  const wsHandler = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
  });

  // --- HTTP server with WS upgrade support ---
  const listener = getRequestListener(app.fetch);
  const server = createServer(listener);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wsHandler.handleUpgrade(req, socket, head);
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

    wsHandler.stopHeartbeat();

    const closeWss = new Promise<void>((resolve) => {
      try {
        wsHandler.wss.close(() => resolve());
      } catch {
        resolve();
      }
    });

    container.watcherProcessor.stop();
    watcherScheduler.stop();

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
  void main();
}
