/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { getRequestListener } from "@hono/node-server";
import { basename, dirname, join } from "node:path";
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
const UPDATE_CHANNEL_TAG: Record<UpdateChannel, string> = {
  stable: "latest",
  beta: "next",
  dev: "dev",
};

type UpdateChannel = "stable" | "beta" | "dev";

type CliCommand =
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "update"; channel: UpdateChannel; version?: string };

export function ensureDatabaseDirectory(dbPath: string): void {
  const trimmed = dbPath.trim();
  if (trimmed.length === 0) return;
  if (trimmed === ":memory:") return;
  if (/^file:/i.test(trimmed)) return;

  const parentDir = dirname(trimmed);
  if (parentDir === "." || parentDir === "") return;

  try {
    mkdirSync(parentDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to create database directory "${parentDir}" for db path "${dbPath}": ${message}`,
    );
  }
}

function printCliHelp(): void {
  console.log(`Tyrum gateway

Usage:
  tyrum
  tyrum update [--channel stable|beta|dev] [--version <version>]
  tyrum --version
  tyrum --help

Notes:
  - Running without subcommands starts the local gateway.
  - --version takes precedence over --channel for updates.
`);
}

function parseUpdateChannel(raw: string): UpdateChannel {
  if (raw === "stable" || raw === "beta" || raw === "dev") {
    return raw;
  }
  throw new Error(
    `invalid update channel '${raw}' (expected stable, beta, or dev)`,
  );
}

function normalizeVersionSpecifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("update --version requires a non-empty value");
  }

  const normalized =
    trimmed.startsWith("v") && trimmed.length > 1 ? trimmed.slice(1) : trimmed;

  if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(normalized)) {
    throw new Error(
      `invalid version '${raw}'. Use release versions like 2026.2.18 or 2026.2.18-beta.1`,
    );
  }

  return normalized;
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "start" };

  const [first, ...rest] = argv;
  if (!first) return { kind: "start" };

  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") {
    return { kind: "version" };
  }
  if (first === "start") return { kind: "start" };

  if (first !== "update") {
    throw new Error(`unknown command '${first}'`);
  }

  let channel: UpdateChannel = "stable";
  let version: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg) continue;

    if (arg === "--channel") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--channel requires a value");
      }
      channel = parseUpdateChannel(value);
      index += 1;
      continue;
    }

    if (arg === "--version") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--version requires a value");
      }
      version = normalizeVersionSpecifier(value);
      index += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }

    throw new Error(`unsupported update argument '${arg}'`);
  }

  return { kind: "update", channel, version };
}

function npmExecutableForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveGatewayUpdateTarget(
  channel: UpdateChannel,
  version?: string,
): string {
  if (version && version.length > 0) return version;
  return UPDATE_CHANNEL_TAG[channel];
}

async function runGatewayUpdate(
  channel: UpdateChannel,
  version?: string,
): Promise<number> {
  const target = resolveGatewayUpdateTarget(channel, version);
  const packageSpec = `@tyrum/gateway@${target}`;
  const npmCmd = npmExecutableForPlatform(process.platform);

  console.log(`Updating ${packageSpec} ...`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(npmCmd, ["install", "-g", packageSpec], {
      stdio: "inherit",
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Update process terminated by signal: ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode === 0) {
    console.log("Update completed.");
    return 0;
  }

  console.error(`Update failed with exit code ${exitCode}.`);
  return exitCode;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    printCliHelp();
    return 1;
  }

  if (command.kind === "help") {
    printCliHelp();
    return 0;
  }

  if (command.kind === "version") {
    console.log(VERSION);
    return 0;
  }

  if (command.kind === "update") {
    return runGatewayUpdate(command.channel, command.version);
  }

  await main();
  return 0;
}

export async function main(): Promise<void> {
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

  ensureDatabaseDirectory(dbPath);

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
    onApprovalDecision: (
      approvalId: number,
      approved: boolean,
      reason: string | undefined,
    ) => {
      container.approvalDal.respond(approvalId, approved, reason);
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
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;

  const filename = basename(entry);
  return filename === "index.mjs" || filename === "index.js" || filename === "index.ts";
})();

if (isMain) {
  void runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`error: ${message}`);
      process.exit(1);
    });
}
