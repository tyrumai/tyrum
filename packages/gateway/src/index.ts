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
import { createContainerAsync } from "./container.js";
import { createApp } from "./app.js";
import { AgentRuntime } from "./modules/agent/runtime.js";
import { isAgentEnabled } from "./modules/agent/enabled.js";
import { TokenStore } from "./modules/auth/token-store.js";
import { WatcherScheduler } from "./modules/watcher/scheduler.js";
import { createSecretProviderFromEnv } from "./modules/secret/create-secret-provider.js";
import { WsNotifier } from "./modules/approval/notifier.js";
import { OutboxDal } from "./modules/backplane/outbox-dal.js";
import { ConnectionDirectoryDal } from "./modules/backplane/connection-directory.js";
import { OutboxPoller } from "./modules/backplane/outbox-poller.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { createWsHandler } from "./routes/ws.js";
import { maybeStartOtel } from "./modules/observability/otel.js";
import { ExecutionEngine, type StepExecutor as ExecutionStepExecutor } from "./modules/execution/engine.js";
import { startExecutionWorkerLoop } from "./modules/execution/worker-loop.js";
import { createToolRunnerStepExecutor } from "./modules/execution/toolrunner-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "./modules/execution/kubernetes-toolrunner-step-executor.js";
import { runToolRunnerFromStdio } from "./toolrunner.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";

export const VERSION = "0.1.0";

// Re-export for library consumers
export { createContainer, createContainerAsync } from "./container.js";
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

type GatewayRole = "all" | "edge" | "worker" | "scheduler";

type CliCommand =
  | { kind: "start"; role: GatewayRole }
  | { kind: "toolrunner" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "update"; channel: UpdateChannel; version?: string };

function parseGatewayRole(raw: string | undefined): GatewayRole | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "all" || value === "edge" || value === "worker" || value === "scheduler") {
    return value;
  }
  return undefined;
}

export function assertSplitRoleUsesPostgres(role: GatewayRole, dbPath: string): void {
  if (role === "all") return;
  if (isPostgresDbUri(dbPath)) return;
  throw new Error(
    `role '${role}' requires Postgres (set GATEWAY_DB_PATH to a postgres:// URI). ` +
      `Use 'all' for single-process SQLite deployments.`,
  );
}

export function ensureDatabaseDirectory(dbPath: string): void {
  const trimmed = dbPath.trim();
  if (trimmed.length === 0) return;
  if (trimmed === ":memory:") return;
  if (/^file:/i.test(trimmed)) return;
  if (isPostgresDbUri(trimmed)) return;

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
  tyrum [start|edge|worker|scheduler]
  tyrum toolrunner
  tyrum update [--channel stable|beta|dev] [--version <version>]
  tyrum --version
  tyrum --help

Notes:
  - Running without subcommands starts all roles (edge + worker + scheduler).
  - You can also set TYRUM_ROLE=all|edge|worker|scheduler.
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
  const envRole = parseGatewayRole(process.env["TYRUM_ROLE"]) ?? "all";
  if (argv.length === 0) return { kind: "start", role: envRole };

  const [first, ...rest] = argv;
  if (!first) return { kind: "start", role: envRole };

  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") {
    return { kind: "version" };
  }
  if (first === "start") return { kind: "start", role: envRole };
  if (first === "all" || first === "edge" || first === "worker" || first === "scheduler") {
    return { kind: "start", role: first };
  }
  if (first === "toolrunner") return { kind: "toolrunner" };

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

  if (command.kind === "toolrunner") {
    return runToolRunnerFromStdio();
  }

  if (command.kind === "update") {
    return runGatewayUpdate(command.channel, command.version);
  }

  await main(command.role);
  return 0;
}

export async function runShutdownCleanup(
  cleanupTasks: readonly Promise<unknown>[],
  closeDb: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled(cleanupTasks);
  await Promise.allSettled([closeDb()]);
}

export async function main(role: GatewayRole = "all"): Promise<void> {
  const port = parseInt(process.env["GATEWAY_PORT"] ?? "8788", 10);
  const host = process.env["GATEWAY_HOST"]?.trim() || "127.0.0.1";
  const dbPath = process.env["GATEWAY_DB_PATH"] ?? "gateway.db";
  assertSplitRoleUsesPostgres(role, dbPath);
  const defaultMigrationsDir = isPostgresDbUri(dbPath)
    ? join(__dirname, "../migrations/postgres")
    : join(__dirname, "../migrations/sqlite");
  const migrationsDir =
    process.env["GATEWAY_MIGRATIONS_DIR"] ?? defaultMigrationsDir;
  const modelGatewayConfigPath =
    process.env["MODEL_GATEWAY_CONFIG"] ?? undefined;

  const tyrumHome =
    process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  const isLocalOnly = LOCAL_HOSTS.has(host);

  ensureDatabaseDirectory(dbPath);

  const container = await createContainerAsync({
    dbPath,
    migrationsDir,
    modelGatewayConfigPath,
    tyrumHome,
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

  // Initialize secret provider (defaults per ADR-0007; override via TYRUM_SECRET_PROVIDER)
  const secretProvider = await createSecretProviderFromEnv(tyrumHome, token);

  if (container.telegramBot) {
    console.log("Telegram bot initialized");
  }

  // Start role-specific background components.
  const watcherScheduler =
    role === "all" || role === "scheduler"
      ? new WatcherScheduler({
          db: container.db,
          memoryDal: container.memoryDal,
          eventBus: container.eventBus,
          keepProcessAlive: role === "scheduler",
        })
      : undefined;

  if (role === "all" || role === "edge") {
    container.watcherProcessor.start();
  }
  if (watcherScheduler) {
    watcherScheduler.start();
  }

  const instanceId =
    process.env["TYRUM_INSTANCE_ID"]?.trim() || `gw-${crypto.randomUUID()}`;
  const logger = container.logger.child({
    role,
    instance_id: instanceId,
    version: VERSION,
  });
  logger.info("gateway.instance", { instance_id: instanceId });

  const otel = await maybeStartOtel({
    serviceName: "tyrum-gateway",
    serviceVersion: VERSION,
    instanceId,
  });
  if (otel.enabled) {
    logger.info("otel.started");
  }

  const shouldRunEdge = role === "all" || role === "edge";

  const connectionManager = new ConnectionManager();
  const outboxDal = new OutboxDal(container.db, container.redactionEngine);
  const connectionDirectory = new ConnectionDirectoryDal(container.db);
  const protocolDeps = {
    connectionManager,
    logger,
    cluster: shouldRunEdge
      ? {
          edgeId: instanceId,
          outboxDal,
          connectionDirectory,
        }
      : undefined,
    onApprovalDecision: (
      approvalId: number,
      approved: boolean,
      reason: string | undefined,
    ) => {
      void container.approvalDal
        .respond(approvalId, approved, reason)
        .then((row) => {
          logger.info("approval.decided", {
            approval_id: approvalId,
            approved,
            status: row?.status ?? "missing",
            reason,
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("approval.decide_failed", {
            approval_id: approvalId,
            approved,
            reason,
            error: message,
          });
        });
    },
  };
  const approvalNotifier = new WsNotifier(protocolDeps);

  const agentRuntime = shouldRunEdge && isAgentEnabled()
    ? new AgentRuntime({ container, secretProvider, approvalNotifier })
    : undefined;

  const app = shouldRunEdge
    ? createApp(container, {
        agentRuntime,
        tokenStore,
        secretProvider,
        isLocalOnly,
        connectionManager,
      })
    : undefined;

  // --- WebSocket handler ---
  const wsHandler = shouldRunEdge
    ? createWsHandler({
        connectionManager,
        protocolDeps,
        tokenStore,
        cluster: {
          instanceId,
          connectionDirectory,
        },
      })
    : undefined;

  const outboxPoller = shouldRunEdge
    ? new OutboxPoller({
        consumerId: instanceId,
        outboxDal,
        connectionManager,
      })
    : undefined;
  outboxPoller?.start();

  // --- HTTP server with WS upgrade support ---
  const server = shouldRunEdge && app && wsHandler
    ? (() => {
        const listener = getRequestListener(app.fetch);
        const s = createServer(listener);

        s.on("upgrade", (req, socket, head) => {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (pathname === "/ws") {
            wsHandler.handleUpgrade(req, socket, head);
          } else {
            socket.destroy();
          }
        });

        s.listen(port, host, () => {
          logger.info("gateway.listen", {
            host,
            port,
            url: `http://${host}:${port}`,
          });
        });
        return s;
      })()
    : undefined;

  if (!shouldRunEdge) {
    console.log(`Tyrum gateway v${VERSION} started in role '${role}'.`);
  }

  const shouldRunWorker = role === "all" || role === "worker";
  const workerLoop = shouldRunWorker
    ? (() => {
        const engine = new ExecutionEngine({
          db: container.db,
          redactionEngine: container.redactionEngine,
          logger,
        });

        const resolveExecutor = (): ExecutionStepExecutor => {
          const launcherRaw = process.env["TYRUM_TOOLRUNNER_LAUNCHER"]?.trim().toLowerCase();
          const isKubernetesRuntime = Boolean(process.env["KUBERNETES_SERVICE_HOST"]);
          const launcher = launcherRaw || (isKubernetesRuntime ? "kubernetes" : "local");

          if (launcher === "kubernetes") {
            const namespace =
              process.env["TYRUM_TOOLRUNNER_NAMESPACE"]?.trim() ??
              process.env["POD_NAMESPACE"]?.trim() ??
              "default";
            const image = process.env["TYRUM_TOOLRUNNER_IMAGE"]?.trim();
            const workspacePvcClaim = process.env["TYRUM_TOOLRUNNER_WORKSPACE_CLAIM"]?.trim();
            if (!image) {
              throw new Error("TYRUM_TOOLRUNNER_IMAGE is required when TYRUM_TOOLRUNNER_LAUNCHER=kubernetes");
            }
            if (!workspacePvcClaim) {
              throw new Error(
                "TYRUM_TOOLRUNNER_WORKSPACE_CLAIM is required when TYRUM_TOOLRUNNER_LAUNCHER=kubernetes",
              );
            }

            return createKubernetesToolRunnerStepExecutor({
              namespace,
              image,
              workspacePvcClaim,
              tyrumHome,
              logger,
              jobTtlSeconds: 300,
            });
          }

          return createToolRunnerStepExecutor({
            entrypoint: fileURLToPath(import.meta.url),
            logger,
          });
        };

        const executor = resolveExecutor() satisfies ExecutionStepExecutor;

        return startExecutionWorkerLoop({
          engine,
          workerId: instanceId,
          executor,
          logger,
        });
      })()
    : undefined;

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
        if (!server) return resolve();
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });

    wsHandler?.stopHeartbeat();

    const closeWss = new Promise<void>((resolve) => {
      try {
        if (!wsHandler) return resolve();
        wsHandler.wss.close(() => resolve());
      } catch {
        resolve();
      }
    });

    container.watcherProcessor.stop();
    watcherScheduler?.stop();
    outboxPoller?.stop();
    workerLoop?.stop();

    void runShutdownCleanup(
      [
        closeServer,
        closeWss,
        agentRuntime?.shutdown() ?? Promise.resolve(),
        otel.shutdown(),
        workerLoop?.done ?? Promise.resolve(),
      ],
      () => container.db.close(),
    )
      .finally(() => {
        clearTimeout(hardExitTimer);
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
