/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { X509Certificate } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { getRequestListener } from "@hono/node-server";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentConfig, DeploymentConfig } from "@tyrum/schemas";
import { wireContainer } from "./container.js";
import type { SqlDb } from "./statestore/types.js";
import { createApp } from "./app.js";
import { NodeDispatchService } from "./modules/agent/node-dispatch-service.js";
import { AuthTokenService } from "./modules/auth/auth-token-service.js";
import { WatcherScheduler } from "./modules/watcher/scheduler.js";
import { WorkSignalScheduler } from "./modules/workboard/signal-scheduler.js";
import { createDbSecretProviderFactory } from "./modules/secret/create-secret-provider.js";
import { ArtifactLifecycleScheduler } from "./modules/artifact/lifecycle.js";
import { WsNotifier } from "./modules/approval/notifier.js";
import { ApprovalEngineActionProcessor } from "./modules/approval/engine-action-processor.js";
import { OutboxDal } from "./modules/backplane/outbox-dal.js";
import { ConnectionDirectoryDal } from "./modules/backplane/connection-directory.js";
import { OutboxLifecycleScheduler } from "./modules/backplane/outbox-lifecycle.js";
import { OutboxPoller } from "./modules/backplane/outbox-poller.js";
import { StateStoreLifecycleScheduler } from "./modules/statestore/lifecycle.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import type { ProtocolDeps } from "./ws/protocol.js";
import { TaskResultRegistry, type TaskResult } from "./ws/protocol/task-result-registry.js";
import { createWsHandler } from "./routes/ws.js";
import { maybeStartOtel } from "./modules/observability/otel.js";
import { AuthAudit } from "./modules/auth/audit.js";
import { SlidingWindowRateLimiter } from "./modules/auth/rate-limiter.js";
import {
  ExecutionEngine,
  type StepExecutor as ExecutionStepExecutor,
} from "./modules/execution/engine.js";
import { startExecutionWorkerLoop } from "./modules/execution/worker-loop.js";
import { TelegramChannelProcessor } from "./modules/channels/telegram.js";
import { createToolRunnerStepExecutor } from "./modules/execution/toolrunner-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "./modules/execution/kubernetes-toolrunner-step-executor.js";
import { createGatewayStepExecutor } from "./modules/execution/gateway-step-executor.js";
import { createNodeDispatchStepExecutor } from "./modules/execution/node-dispatch-step-executor.js";
import { runToolRunnerFromStdio } from "./toolrunner.js";
import { DeploymentConfigDal } from "./modules/config/deployment-config-dal.js";
import { AgentConfigDal } from "./modules/config/agent-config-dal.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { VERSION } from "./version.js";
import { PluginRegistry } from "./modules/plugins/registry.js";
import { installPluginFromDir } from "./modules/plugins/installer.js";
import { AgentRegistry } from "./modules/agent/registry.js";
import { loadLifecycleHooksFromHome } from "./modules/hooks/config.js";
import { LifecycleHooksRuntime } from "./modules/hooks/runtime.js";
import { ensureSelfSignedTlsMaterial } from "./modules/tls/self-signed.js";
import { DEFAULT_TENANT_ID } from "./modules/identity/scope.js";
import { createMemoryV1BudgetsProvider } from "./modules/memory/v1-budgets-provider.js";

// Re-export for library consumers
export { VERSION } from "./version.js";
export { createContainer, createContainerAsync } from "./container.js";
export type { GatewayContainer, GatewayContainerConfig } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";
export { createWsHandler } from "./routes/ws.js";
export type { WsRouteOptions } from "./routes/ws.js";
export { ConnectionManager } from "./ws/connection-manager.js";
export type { ConnectedClient, ConnectionStats } from "./ws/connection-manager.js";

export function formatFatalErrorForConsole(error: unknown): string {
  const safeToString = (value: unknown): string => {
    try {
      return String(value);
    } catch {
      return "[unstringifiable]";
    }
  };

  const safeJsonStringify = (value: unknown): string | undefined => {
    try {
      return JSON.stringify(value) ?? undefined;
    } catch {
      return undefined;
    }
  };

  let formatted = "Error: [unable to format fatal error]";

  try {
    if (error instanceof Error) {
      const rawName = (error as { name?: unknown }).name;
      const name = typeof rawName === "string" && rawName.trim() ? rawName : "Error";

      const rawMessage = (error as { message?: unknown }).message;
      const message =
        typeof rawMessage === "string"
          ? rawMessage
          : rawMessage == null
            ? ""
            : safeToString(rawMessage);

      formatted = `${name}: ${message}`;
    } else {
      const errorType = typeof error;
      const stringified =
        typeof error === "string" ? error : (safeJsonStringify(error) ?? safeToString(error));
      formatted = `${errorType}: ${stringified}`;
    }
  } catch {
    // Keep fallback.
  }

  const redactUriUserinfo = (text: string): string => {
    if (!text.includes("://") || !text.includes("@")) return text;

    let cursor = 0;
    let redacted = "";
    let changed = false;

    while (cursor < text.length) {
      const schemeSepIndex = text.indexOf("://", cursor);
      if (schemeSepIndex === -1) break;

      const authorityStart = schemeSepIndex + 3;
      redacted += text.slice(cursor, authorityStart);

      let scanIndex = authorityStart;
      while (scanIndex < text.length) {
        const ch = text.charCodeAt(scanIndex);

        // '@' - end of userinfo (if any)
        if (ch === 64) {
          if (scanIndex !== authorityStart) {
            redacted += "***@";
            changed = true;
          } else {
            redacted += "@";
          }
          cursor = scanIndex + 1;
          break;
        }

        // End of authority (path/query/fragment/whitespace)
        if (
          ch === 47 || // /
          ch === 63 || // ?
          ch === 35 || // #
          ch === 32 || // space
          ch === 9 || // \t
          ch === 10 || // \n
          ch === 13 || // \r
          ch === 12 // \f
        ) {
          redacted += text.slice(authorityStart, scanIndex);
          cursor = scanIndex;
          break;
        }

        scanIndex += 1;
      }

      if (scanIndex >= text.length) {
        redacted += text.slice(authorityStart);
        cursor = text.length;
        break;
      }
    }

    if (!changed) return text;
    return redacted + text.slice(cursor);
  };

  // Redact URI-style userinfo (e.g. postgres://user:pass@host -> postgres://***@host)
  formatted = redactUriUserinfo(formatted);

  return formatted.length > 500 ? formatted.slice(0, 500) : formatted;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOOPBACK_HOSTNAMES = new Set(["localhost"]);

function normalizeHostForLoopbackCheck(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostForLoopbackCheck(host).toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return normalized.startsWith("127.");
  }
  if (ipVersion === 6) {
    return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
  }
  return false;
}
const UPDATE_CHANNEL_TAG: Record<UpdateChannel, string> = {
  stable: "latest",
  beta: "next",
  dev: "dev",
};

type UpdateChannel = "stable" | "beta" | "dev";

type GatewayRole = "all" | "edge" | "worker" | "scheduler";

export type NonLoopbackTransportPolicy = "local" | "tls" | "insecure";

export function assertNonLoopbackDeploymentGuardrails(input: {
  role: GatewayRole;
  host: string;
  tlsReady?: boolean;
  tlsSelfSigned?: boolean;
  allowInsecureHttp?: boolean;
  hasTenantAdminToken?: boolean;
}): NonLoopbackTransportPolicy {
  const shouldRunEdge = input.role === "all" || input.role === "edge";
  if (!shouldRunEdge) return "local";

  const hostSplit = splitHostAndPort(input.host);
  const hostForLoopback = hostSplit.host.length > 0 ? hostSplit.host : input.host;
  const isLocalOnly = isLoopbackHost(hostForLoopback);
  if (isLocalOnly) return "local";

  if (input.hasTenantAdminToken === false) {
    throw new Error(
      "Gateway is configured to bind to a non-loopback address but no tenant admin tokens exist. " +
        "Create a tenant admin token before exposing the gateway beyond loopback.",
    );
  }

  const tlsReady = input.tlsReady ?? false;
  const tlsSelfSigned = input.tlsSelfSigned ?? false;
  if (tlsReady || tlsSelfSigned) return "tls";

  const allowInsecureHttp = input.allowInsecureHttp ?? false;
  if (allowInsecureHttp) return "insecure";

  throw new Error(
    "Gateway is configured to bind to a non-loopback address. Remote operation requires TLS. " +
      "Configure TLS termination and set deployment config server.tlsReady=true (recommended), " +
      "or set deployment config server.tlsSelfSigned=true to enable built-in self-signed TLS, " +
      "or set deployment config server.allowInsecureHttp=true to acknowledge and allow plaintext HTTP in a trusted network.",
  );
}

type CliCommand =
  | {
      kind: "start";
      role?: GatewayRole;
      home?: string;
      db?: string;
      host?: string;
      port?: number;
      migrationsDir?: string;
      allowInsecureHttp?: boolean;
      engineApiEnabled?: boolean;
      snapshotImportEnabled?: boolean;
    }
  | { kind: "check"; home?: string; db?: string; migrationsDir?: string }
  | { kind: "tls_fingerprint"; home?: string }
  | { kind: "toolrunner"; home?: string; db?: string; migrationsDir?: string; payloadB64?: string }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "update"; channel: UpdateChannel; version?: string }
  | { kind: "plugin_install"; source_dir: string; home?: string };

export function assertSplitRoleUsesPostgres(role: GatewayRole, dbPath: string): void {
  if (role === "all") return;
  if (isPostgresDbUri(dbPath)) return;
  throw new Error(
    `role '${role}' requires Postgres (set --db to a postgres:// URI). ` +
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

function resolveGatewayHome(homeOverride?: string): string {
  const trimmed = homeOverride?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : join(homedir(), ".tyrum");
}

function resolveGatewayDbPath(home: string, dbOverride?: string): string {
  const trimmed = dbOverride?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return join(home, "gateway.db");
}

function resolveGatewayHost(hostOverride?: string): string {
  const trimmed = hostOverride?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "127.0.0.1";
}

function resolveGatewayPort(portOverride?: number): number {
  if (typeof portOverride === "number" && Number.isFinite(portOverride)) {
    const parsed = Math.floor(portOverride);
    if (parsed >= 1 && parsed <= 65535) return parsed;
  }
  return 8788;
}

function resolveDefaultMigrationsDir(dbPath: string): string {
  return isPostgresDbUri(dbPath)
    ? join(__dirname, "../migrations/postgres")
    : join(__dirname, "../migrations/sqlite");
}

function resolveGatewayMigrationsDir(dbPath: string, override?: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : resolveDefaultMigrationsDir(dbPath);
}

function resolveTruthyEnvFlag(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function resolveSnapshotImportEnabled(snapshotImportOverride?: boolean): boolean {
  return Boolean(snapshotImportOverride) || resolveTruthyEnvFlag("TYRUM_SNAPSHOT_IMPORT_ENABLED");
}

type StartCommandOverrides = Pick<
  Extract<CliCommand, { kind: "start" }>,
  "allowInsecureHttp" | "engineApiEnabled" | "snapshotImportEnabled"
>;

export function buildStartupDefaultDeploymentConfig(
  overrides: StartCommandOverrides,
): DeploymentConfig {
  return DeploymentConfig.parse({
    server: {
      allowInsecureHttp: Boolean(overrides.allowInsecureHttp),
    },
    execution: {
      engineApiEnabled: Boolean(overrides.engineApiEnabled),
    },
    snapshots: {
      importEnabled: resolveSnapshotImportEnabled(overrides.snapshotImportEnabled),
    },
  });
}

export function applyStartCommandDeploymentOverrides(
  deploymentConfig: DeploymentConfig,
  overrides: StartCommandOverrides,
): DeploymentConfig {
  return DeploymentConfig.parse({
    ...deploymentConfig,
    server: {
      ...deploymentConfig.server,
      allowInsecureHttp:
        deploymentConfig.server.allowInsecureHttp || Boolean(overrides.allowInsecureHttp),
    },
    execution: {
      ...deploymentConfig.execution,
      engineApiEnabled:
        deploymentConfig.execution.engineApiEnabled || Boolean(overrides.engineApiEnabled),
    },
    snapshots: {
      ...deploymentConfig.snapshots,
      importEnabled:
        deploymentConfig.snapshots.importEnabled || Boolean(overrides.snapshotImportEnabled),
    },
  });
}

async function openGatewayDb(params: { dbPath: string; migrationsDir: string }): Promise<SqlDb> {
  const dbPath = params.dbPath.trim();
  if (isPostgresDbUri(dbPath)) {
    return await PostgresDb.open({ dbUri: dbPath, migrationsDir: params.migrationsDir });
  }
  return SqliteDb.open({ dbPath, migrationsDir: params.migrationsDir });
}

function printCliHelp(): void {
  console.log(`Tyrum gateway

Usage:
  tyrum [start|edge|worker|scheduler] [--home <path>] [--db <path|postgres-uri>] [--host <host>] [--port <port>] [--role <role>]
  tyrum check
  tyrum tls fingerprint
  tyrum toolrunner
  tyrum plugin install <dir> [--home <path>]
  tyrum update [--channel stable|beta|dev] [--version <version>]
  tyrum --version
  tyrum --help

Notes:
  - Running without subcommands starts all roles (edge + worker + scheduler).
  - --version takes precedence over --channel for updates.
`);
}

function parseUpdateChannel(raw: string): UpdateChannel {
  if (raw === "stable" || raw === "beta" || raw === "dev") {
    return raw;
  }
  throw new Error(`invalid update channel '${raw}' (expected stable, beta, or dev)`);
}

function normalizeVersionSpecifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("update --version requires a non-empty value");
  }

  const normalized = trimmed.startsWith("v") && trimmed.length > 1 ? trimmed.slice(1) : trimmed;

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
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };

  const parsePortFlag = (value: string): number => {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error(`--port must be an integer between 1 and 65535 (got '${value}')`);
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`--port must be an integer between 1 and 65535 (got '${value}')`);
    }
    return parsed;
  };

  const parseRoleFlag = (value: string): GatewayRole => {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "all" ||
      normalized === "edge" ||
      normalized === "worker" ||
      normalized === "scheduler"
    ) {
      return normalized;
    }
    throw new Error(`--role must be one of all|edge|worker|scheduler (got '${value}')`);
  };

  type CommonDbFlags = { home?: string; db?: string; migrationsDir?: string };

  const parseCommonDbFlag = (
    args: readonly string[],
    index: number,
    target: CommonDbFlags,
  ): { handled: boolean; nextIndex: number } => {
    const arg = args[index];
    if (!arg) return { handled: false, nextIndex: index };

    if (arg === "--home") {
      const value = args[index + 1];
      if (!value) throw new Error("--home requires a value");
      target.home = value;
      return { handled: true, nextIndex: index + 1 };
    }

    if (arg === "--db") {
      const value = args[index + 1];
      if (!value) throw new Error("--db requires a value");
      target.db = value;
      return { handled: true, nextIndex: index + 1 };
    }

    if (arg === "--migrations-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--migrations-dir requires a value");
      target.migrationsDir = value;
      return { handled: true, nextIndex: index + 1 };
    }

    return { handled: false, nextIndex: index };
  };

  const parseStartFlags = (
    args: readonly string[],
  ): Omit<CliCommand & { kind: "start" }, "kind"> | { kind: "help" } => {
    const common: CommonDbFlags = {};
    let host: string | undefined;
    let port: number | undefined;
    let role: GatewayRole | undefined;
    let allowInsecureHttp: true | undefined;
    let engineApiEnabled: true | undefined;
    let snapshotImportEnabled: true | undefined;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      const commonFlag = parseCommonDbFlag(args, index, common);
      if (commonFlag.handled) {
        index = commonFlag.nextIndex;
        continue;
      }

      if (arg === "--host") {
        const value = args[index + 1];
        if (!value) throw new Error("--host requires a value");
        host = value;
        index += 1;
        continue;
      }

      if (arg === "--port") {
        const value = args[index + 1];
        if (!value) throw new Error("--port requires a value");
        port = parsePortFlag(value);
        index += 1;
        continue;
      }

      if (arg === "--role") {
        const value = args[index + 1];
        if (!value) throw new Error("--role requires a value");
        role = parseRoleFlag(value);
        index += 1;
        continue;
      }

      if (arg === "--allow-insecure-http") {
        allowInsecureHttp = true;
        continue;
      }

      if (arg === "--enable-engine-api") {
        engineApiEnabled = true;
        continue;
      }

      if (arg === "--enable-snapshot-import") {
        snapshotImportEnabled = true;
        continue;
      }

      throw new Error(`unsupported start argument '${arg}'`);
    }

    return {
      home: common.home,
      db: common.db,
      host,
      port,
      role,
      migrationsDir: common.migrationsDir,
      allowInsecureHttp,
      engineApiEnabled,
      snapshotImportEnabled,
    };
  };

  const parseDbFlags = (
    args: readonly string[],
  ): { home?: string; db?: string; migrationsDir?: string } | { kind: "help" } => {
    const common: CommonDbFlags = {};

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      const commonFlag = parseCommonDbFlag(args, index, common);
      if (commonFlag.handled) {
        index = commonFlag.nextIndex;
        continue;
      }

      throw new Error(`unsupported argument '${arg}'`);
    }

    return { home: common.home, db: common.db, migrationsDir: common.migrationsDir };
  };

  const parseToolrunnerFlags = (
    args: readonly string[],
  ):
    | { home?: string; db?: string; migrationsDir?: string; payloadB64?: string }
    | { kind: "help" } => {
    const common: CommonDbFlags = {};
    let payloadB64: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      const commonFlag = parseCommonDbFlag(args, index, common);
      if (commonFlag.handled) {
        index = commonFlag.nextIndex;
        continue;
      }

      if (arg === "--payload-b64") {
        const value = args[index + 1];
        if (!value) throw new Error("--payload-b64 requires a value");
        payloadB64 = value;
        index += 1;
        continue;
      }

      throw new Error(`unsupported argument '${arg}'`);
    }

    return {
      home: common.home,
      db: common.db,
      migrationsDir: common.migrationsDir,
      payloadB64,
    };
  };

  if (first === "start") {
    const flags = parseStartFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "start", ...flags };
  }

  if (first === "all" || first === "edge" || first === "worker" || first === "scheduler") {
    const flags = parseStartFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "start", ...flags, role: flags.role ?? first };
  }

  if (first === "check") {
    const flags = parseDbFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "check", ...flags };
  }

  if (first === "toolrunner") {
    const flags = parseToolrunnerFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "toolrunner", ...flags };
  }

  if (first === "tls") {
    const [subcommand, ...args] = rest;
    if (!subcommand) throw new Error("tls requires a subcommand (fingerprint)");
    if (subcommand === "-h" || subcommand === "--help") return { kind: "help" };
    if (subcommand !== "fingerprint") throw new Error(`unknown tls command '${subcommand}'`);

    const flags = parseDbFlags(args);
    if ("kind" in flags) return flags;
    if (flags.db || flags.migrationsDir) {
      throw new Error("tls fingerprint only supports --home");
    }
    return { kind: "tls_fingerprint", home: flags.home };
  }

  if (first === "plugin") {
    const [subcommand, ...args] = rest;
    if (subcommand === "-h" || subcommand === "--help") return { kind: "help" };
    if (subcommand !== "install") {
      throw new Error(`unknown plugin command '${subcommand ?? ""}'`);
    }

    let sourceDir: string | undefined;
    let home: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;

      if (arg === "--home") {
        const value = args[index + 1];
        if (!value) {
          throw new Error("--home requires a value");
        }
        home = value;
        index += 1;
        continue;
      }

      if (arg === "-h" || arg === "--help") {
        return { kind: "help" };
      }

      if (arg.startsWith("-")) {
        throw new Error(`unsupported plugin install argument '${arg}'`);
      }

      if (!sourceDir) {
        sourceDir = arg;
        continue;
      }

      throw new Error(`unexpected plugin install argument '${arg}'`);
    }

    if (!sourceDir) {
      throw new Error("plugin install requires a source directory");
    }

    return { kind: "plugin_install", source_dir: sourceDir, home };
  }

  if (first !== "update") throw new Error(`unknown command '${first}'`);

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

export function resolveGatewayUpdateTarget(channel: UpdateChannel, version?: string): string {
  if (version && version.length > 0) return version;
  return UPDATE_CHANNEL_TAG[channel];
}

async function runGatewayUpdate(channel: UpdateChannel, version?: string): Promise<number> {
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

export function splitHostAndPort(rawHost: string): { host: string; port: string | null } {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) {
    return { host: "", port: null };
  }

  if (trimmed.startsWith("[")) {
    const closeBracket = trimmed.indexOf("]");
    if (closeBracket !== -1) {
      const host = trimmed.slice(1, closeBracket);
      const rest = trimmed.slice(closeBracket + 1);
      if (rest.startsWith(":")) {
        const port = rest.slice(1);
        if (/^[0-9]+$/.test(port)) {
          return { host, port };
        }
      }
      return { host, port: null };
    }
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = trimmed.slice(lastColon + 1);
    if (host.length > 0 && /^[0-9]+$/.test(port)) {
      return { host, port };
    }
  }

  // Heuristic: treat unbracketed IPv6 values ending in :<digits> as host:port
  // when the portion before the last colon is itself a valid IPv6 address.
  //
  // This prevents forming incorrect probe URLs like `http://[::1:8788]:8788`
  // when a user passes --host "::1:8788".
  if (firstColon !== -1 && firstColon !== lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = trimmed.slice(lastColon + 1);
    if (host.length > 0 && /^[0-9]+$/.test(port) && isIP(host) === 6) {
      return { host, port };
    }
  }

  return { host: trimmed, port: null };
}

async function runGatewayCheck(cmd: Extract<CliCommand, { kind: "check" }>): Promise<number> {
  const tyrumHome = resolveGatewayHome(cmd.home);
  const dbPath = resolveGatewayDbPath(tyrumHome, cmd.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, cmd.migrationsDir);

  let db: SqlDb | undefined;
  try {
    ensureDatabaseDirectory(dbPath);
    db = await openGatewayDb({ dbPath, migrationsDir });

    const deploymentConfigDal = new DeploymentConfigDal(db);
    const deployment = await deploymentConfigDal.ensureSeeded({
      defaultConfig: DeploymentConfig.parse({}),
      createdBy: { kind: "bootstrap.check" },
      reason: "seed",
    });

    const authTokens = new AuthTokenService(db);
    const systemTokens = await authTokens.countActiveSystemTokens();
    const defaultTenantTokens = await authTokens.countActiveTenantTokens(DEFAULT_TENANT_ID);

    console.log("check: ok");
    console.log(`db: kind=${db.kind} path=${dbPath}`);
    console.log(
      `deployment_config: revision=${deployment.revision} sha256=${deployment.configSha256.slice(0, 12)}`,
    );
    console.log(
      `auth_tokens: system=${String(systemTokens)} default_tenant=${String(defaultTenantTokens)}`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`check: failed: ${message}`);
    return 1;
  } finally {
    await db?.close().catch((closeErr) => {
      const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error(`check: warning: failed to close db: ${message}`);
    });
  }
}

async function runTlsFingerprint(
  cmd: Extract<CliCommand, { kind: "tls_fingerprint" }>,
): Promise<number> {
  const tyrumHome = resolveGatewayHome(cmd.home);
  const certPath = join(tyrumHome, "tls", "cert.pem");

  try {
    const certPem = await readFile(certPath, "utf-8");
    const fingerprint256 = new X509Certificate(certPem).fingerprint256;
    console.log(`fingerprint256=${fingerprint256}`);
    console.log(`cert_path=${certPath}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `tls fingerprint: failed: ${message}. ` +
        `Expected a certificate at ${certPath}. ` +
        "Start the gateway with self-signed TLS enabled to generate one.",
    );
    return 1;
  }
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

  if (command.kind === "check") {
    return await runGatewayCheck(command);
  }

  if (command.kind === "tls_fingerprint") {
    return await runTlsFingerprint(command);
  }

  if (command.kind === "toolrunner") {
    return runToolRunnerFromStdio({
      home: command.home,
      db: command.db,
      migrationsDir: command.migrationsDir,
      payloadB64: command.payloadB64,
    });
  }

  if (command.kind === "plugin_install") {
    const tyrumHome = resolveGatewayHome(command.home);
    try {
      const result = await installPluginFromDir({
        home: tyrumHome,
        sourceDir: command.source_dir,
      });
      console.log(`plugin.install: ok id=${result.plugin_id} dir=${result.plugin_dir}`);
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`plugin.install: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "update") {
    return runGatewayUpdate(command.channel, command.version);
  }

  await main({
    role: command.role,
    home: command.home,
    db: command.db,
    host: command.host,
    port: command.port,
    migrationsDir: command.migrationsDir,
    allowInsecureHttp: command.allowInsecureHttp,
    engineApiEnabled: command.engineApiEnabled,
    snapshotImportEnabled: command.snapshotImportEnabled,
  });
  return 0;
}

export async function runShutdownCleanup(
  cleanupTasks: readonly Promise<unknown>[],
  closeDb: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled(cleanupTasks);
  await Promise.allSettled([closeDb()]);
}

export async function main(
  input?:
    | GatewayRole
    | {
        role?: GatewayRole;
        home?: string;
        db?: string;
        host?: string;
        port?: number;
        migrationsDir?: string;
        allowInsecureHttp?: boolean;
        engineApiEnabled?: boolean;
        snapshotImportEnabled?: boolean;
      },
): Promise<void> {
  const params = typeof input === "string" ? { role: input } : (input ?? {});

  const instanceId = `gw-${crypto.randomUUID()}`;
  const role = params.role ?? "all";
  const tyrumHome = resolveGatewayHome(params.home);

  const hostRaw = resolveGatewayHost(params.host);
  const hostSplit = splitHostAndPort(hostRaw);
  if (hostSplit.port) {
    throw new Error(
      `--host must not include a port (got '${hostRaw}'). Use --port ${hostSplit.port} instead.`,
    );
  }
  const host = hostSplit.host;
  const port = resolveGatewayPort(params.port);

  const dbPath = resolveGatewayDbPath(tyrumHome, params.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, params.migrationsDir);
  const isLocalOnly = isLoopbackHost(host);

  assertSplitRoleUsesPostgres(role, dbPath);
  ensureDatabaseDirectory(dbPath);

  const db = await openGatewayDb({ dbPath, migrationsDir });
  const deploymentConfigDal = new DeploymentConfigDal(db);
  const startupOverrides: StartCommandOverrides = {
    allowInsecureHttp: params.allowInsecureHttp,
    engineApiEnabled: params.engineApiEnabled,
    snapshotImportEnabled: params.snapshotImportEnabled,
  };
  const deploymentRevision = await deploymentConfigDal.ensureSeeded({
    defaultConfig: buildStartupDefaultDeploymentConfig(startupOverrides),
    createdBy: { kind: "bootstrap" },
    reason: "seed",
  });
  const deploymentConfig = applyStartCommandDeploymentOverrides(
    deploymentRevision.config,
    startupOverrides,
  );

  const container = wireContainer(
    db,
    {
      dbPath,
      migrationsDir,
      tyrumHome,
    },
    { deploymentConfig },
  );
  container.modelsDev.startBackgroundRefresh();

  const defaultScope = await container.identityScopeDal.resolveScopeIds();
  await new AgentConfigDal(container.db).ensureSeeded({
    tenantId: defaultScope.tenantId,
    agentId: defaultScope.agentId,
    defaultConfig: AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      tools: { allow: ["tool.fs.read"] },
    }),
    createdBy: { kind: "bootstrap" },
    reason: "seed",
  });

  const authTokens = new AuthTokenService(container.db);

  const bootstrapTokens: Array<{ label: string; token: string }> = [];
  if ((await authTokens.countActiveSystemTokens()) === 0) {
    const issued = await authTokens.issueToken({
      tenantId: null,
      role: "admin",
      scopes: ["*"],
    });
    bootstrapTokens.push({ label: "system", token: issued.token });
  }
  let hasDefaultTenantAdminToken =
    (await authTokens.countActiveTenantAdminTokens(DEFAULT_TENANT_ID)) > 0;
  if (!hasDefaultTenantAdminToken) {
    const issued = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    bootstrapTokens.push({ label: "default-tenant-admin", token: issued.token });
    hasDefaultTenantAdminToken = true;
  }
  if (bootstrapTokens.length > 0) {
    console.log("---");
    console.log("Bootstrap tokens (printed once):");
    for (const entry of bootstrapTokens) {
      console.log(`${entry.label}: ${entry.token}`);
    }
    console.log("---");
  }

  const transportPolicy = assertNonLoopbackDeploymentGuardrails({
    role,
    host,
    tlsReady: deploymentConfig.server.tlsReady,
    tlsSelfSigned: deploymentConfig.server.tlsSelfSigned,
    allowInsecureHttp: deploymentConfig.server.allowInsecureHttp,
    hasTenantAdminToken: hasDefaultTenantAdminToken,
  });

  if (transportPolicy !== "local") {
    console.log("---");
    console.log("Gateway is exposed on a non-local interface.");
    if (transportPolicy === "insecure") {
      console.log(
        "WARNING: plaintext HTTP is allowed by deployment config server.allowInsecureHttp.",
      );
      console.log("Configure TLS termination and set deployment config server.tlsReady=true.");
    }
    console.log("---");
  }

  const logger = container.logger.child({
    role,
    instance_id: instanceId,
    version: VERSION,
  });
  logger.info("gateway.instance", { instance_id: instanceId });

  const secrets = await createDbSecretProviderFactory({ db: container.db, dbPath, tyrumHome });
  const secretProviderForTenant = secrets.secretProviderForTenant;

  const lifecycleHooks = await loadLifecycleHooksFromHome(tyrumHome, logger);
  const shouldRunEdge = role === "all" || role === "edge";
  const shouldRunWorker = role === "all" || role === "worker";

  if (container.telegramBot) {
    console.log("Telegram bot initialized");
  }

  // Start role-specific background components.
  const watcherScheduler =
    role === "all" || role === "scheduler"
      ? new WatcherScheduler({
          db: container.db,
          memoryV1Dal: container.memoryV1Dal,
          eventBus: container.eventBus,
          automationEnabled: deploymentConfig.automation.enabled,
          keepProcessAlive: role === "scheduler",
        })
      : undefined;
  const artifactLifecycleScheduler =
    role === "all" || role === "scheduler"
      ? new ArtifactLifecycleScheduler({
          db: container.db,
          artifactStore: container.artifactStore,
          policySnapshotDal: container.policySnapshotDal,
          keepProcessAlive: role === "scheduler",
          logger: container.logger,
        })
      : undefined;
  const outboxLifecycleScheduler =
    role === "all" || role === "scheduler"
      ? new OutboxLifecycleScheduler({
          db: container.db,
          keepProcessAlive: role === "scheduler",
          logger: container.logger,
        })
      : undefined;
  const stateStoreLifecycleScheduler =
    role === "all" || role === "scheduler"
      ? new StateStoreLifecycleScheduler({
          db: container.db,
          keepProcessAlive: role === "scheduler",
          logger: container.logger,
        })
      : undefined;

  if (shouldRunEdge) {
    container.watcherProcessor.start();
  }
  if (watcherScheduler) {
    watcherScheduler.start();
  }
  if (artifactLifecycleScheduler) {
    artifactLifecycleScheduler.start();
  }
  if (outboxLifecycleScheduler) {
    outboxLifecycleScheduler.start();
  }
  if (stateStoreLifecycleScheduler) {
    stateStoreLifecycleScheduler.start();
  }

  const otel = await maybeStartOtel({
    serviceName: "tyrum-gateway",
    serviceVersion: VERSION,
    instanceId,
    otel: deploymentConfig.otel,
  });
  if (otel.enabled) {
    logger.info("otel.started");
  }

  const engineApiEnabled = deploymentConfig.execution.engineApiEnabled;

  const connectionManager = new ConnectionManager();
  const outboxDal = new OutboxDal(container.db, container.redactionEngine);
  const connectionDirectory = new ConnectionDirectoryDal(container.db);
  const workSignalScheduler =
    role === "all" || role === "scheduler"
      ? new WorkSignalScheduler({
          db: container.db,
          connectionManager,
          owner: instanceId,
          logger,
          cluster: { edgeId: instanceId, outboxDal },
          keepProcessAlive: role === "scheduler",
        })
      : undefined;
  workSignalScheduler?.start();
  const wsEngine = shouldRunEdge
    ? new ExecutionEngine({
        db: container.db,
        redactionEngine: container.redactionEngine,
        secretProviderForTenant,
        policyService: container.policyService,
        logger,
      })
    : undefined;
  const edgeEngine = engineApiEnabled ? wsEngine : undefined;

  const hooksRuntime =
    lifecycleHooks.length > 0 && (shouldRunEdge || shouldRunWorker)
      ? new LifecycleHooksRuntime({
          db: container.db,
          engine:
            edgeEngine ??
            new ExecutionEngine({
              db: container.db,
              redactionEngine: container.redactionEngine,
              policyService: container.policyService,
              logger,
            }),
          policyService: container.policyService,
          hooks: lifecycleHooks,
        })
      : undefined;

  const taskResults = new TaskResultRegistry();
  const toTaskResult = (
    success: boolean,
    result: unknown,
    evidence: unknown,
    error: string | undefined,
  ): TaskResult => {
    if (success) {
      const taskResult: TaskResult = { ok: true };
      if (result !== undefined) taskResult.result = result;
      if (evidence !== undefined) taskResult.evidence = evidence;
      return taskResult;
    }
    const taskResult: TaskResult = { ok: false, error: error ?? "task failed" };
    if (result !== undefined) {
      taskResult.result = result;
    }
    if (evidence !== undefined) {
      taskResult.evidence = evidence;
    }
    return taskResult;
  };
  const protocolDeps: ProtocolDeps = {
    connectionManager,
    logger,
    db: container.db,
    redactionEngine: container.redactionEngine,
    memoryV1Dal: container.memoryV1Dal,
    artifactStore: container.artifactStore,
    authAudit: new AuthAudit({ eventLog: container.eventLog, logger }),
    contextReportDal: container.contextReportDal,
    runtime: {
      version: VERSION,
      instanceId,
      role,
      dbKind: container.db.kind,
      isExposed: !isLocalOnly,
      otelEnabled: otel.enabled,
    },
    approvalDal: container.approvalDal,
    presenceDal: container.presenceDal,
    policyOverrideDal: container.policyOverrideDal,
    nodePairingDal: container.nodePairingDal,
    engine: edgeEngine,
    policyService: container.policyService,
    modelsDev: container.modelsDev,
    modelCatalog: container.modelCatalog,
    cluster: shouldRunEdge
      ? {
          edgeId: instanceId,
          outboxDal,
          connectionDirectory,
        }
      : undefined,
    taskResults,
    hooks: hooksRuntime,
    onTaskResult: (taskId, success, result, evidence, error) => {
      taskResults.resolve(taskId, toTaskResult(success, result, evidence, error));
    },
    onConnectionClosed: (connectionId) => {
      taskResults.rejectAllForConnection(connectionId);
    },
    onApprovalDecision: (
      tenantId: string,
      approvalId: string,
      approved: boolean,
      reason: string | undefined,
    ) => {
      void container.approvalDal
        .resolveWithEngineAction({
          tenantId,
          approvalId,
          decision: approved ? "approved" : "denied",
          reason,
          resolvedBy: { kind: "ws.operator" },
        })
        .then(async (res) => {
          const row = res?.approval;
          const transitioned = res?.transitioned ?? false;
          const desiredStatus = approved ? "approved" : "denied";
          const decisionMatches = row?.status === desiredStatus;

          logger.info("approval.decided", {
            approval_id: approvalId,
            approved,
            status: row?.status ?? "missing",
            reason,
            decision_matches: decisionMatches,
            transitioned,
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

  const plugins = shouldRunEdge
    ? await PluginRegistry.load({
        home: tyrumHome,
        userHome: tyrumHome,
        logger,
        container,
      })
    : undefined;
  protocolDeps.plugins = plugins;

  const agents =
    shouldRunEdge && deploymentConfig.agent.enabled
      ? new AgentRegistry({
          container,
          baseHome: tyrumHome,
          secretProviderForTenant,
          defaultPolicyService: container.policyService,
          approvalNotifier,
          plugins,
          protocolDeps,
          logger,
        })
      : undefined;
  protocolDeps.agents = agents;
  protocolDeps.memoryV1BudgetsProvider = createMemoryV1BudgetsProvider(container.db);

  const authRateLimitWindowS = deploymentConfig.auth.rateLimit.windowSeconds;
  const authRateLimitMax = deploymentConfig.auth.rateLimit.max;
  const wsUpgradeRateLimitMax = Math.max(1, Math.floor(authRateLimitMax / 2));

  const authRateLimiter = shouldRunEdge
    ? new SlidingWindowRateLimiter({
        windowMs: authRateLimitWindowS * 1_000,
        max: authRateLimitMax,
      })
    : undefined;

  const wsUpgradeRateLimiter = shouldRunEdge
    ? new SlidingWindowRateLimiter({
        windowMs: authRateLimitWindowS * 1_000,
        max: wsUpgradeRateLimitMax,
      })
    : undefined;

  const app = shouldRunEdge
    ? createApp(container, {
        agents,
        plugins,
        authTokens,
        secretProviderForTenant,
        isLocalOnly,
        connectionManager,
        connectionDirectory,
        authRateLimiter,
        engine: edgeEngine,
        wsCluster: {
          edgeId: instanceId,
          outboxDal,
        },
        runtime: {
          version: VERSION,
          instanceId,
          role,
          otelEnabled: otel.enabled,
        },
      })
    : undefined;

  // --- WebSocket handler ---
  const wsHandler = shouldRunEdge
    ? createWsHandler({
        connectionManager,
        protocolDeps,
        authTokens,
        trustedProxies: deploymentConfig.server.trustedProxies,
        upgradeRateLimiter: wsUpgradeRateLimiter,
        presenceDal: container.presenceDal,
        nodePairingDal: container.nodePairingDal,
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
        logger,
      })
    : undefined;
  outboxPoller?.start();

  const telegramProcessor =
    shouldRunEdge && agents && container.telegramBot && deploymentConfig.channels.pipelineEnabled
      ? new TelegramChannelProcessor({
          db: container.db,
          sessionDal: container.sessionDal,
          agents,
          telegramBot: container.telegramBot,
          owner: instanceId,
          logger,
          typingMode: deploymentConfig.channels.typingMode,
          typingRefreshMs: deploymentConfig.channels.typingRefreshMs,
          typingAutomationEnabled: deploymentConfig.channels.typingAutomationEnabled,
          memoryV1Dal: container.memoryV1Dal,
          approvalDal: container.approvalDal,
          approvalNotifier,
        })
      : undefined;
  telegramProcessor?.start();

  const approvalEngineActionProcessor =
    shouldRunEdge || shouldRunWorker
      ? new ApprovalEngineActionProcessor({
          db: container.db,
          engine:
            edgeEngine ??
            new ExecutionEngine({
              db: container.db,
              redactionEngine: container.redactionEngine,
              logger,
            }),
          owner: instanceId,
          logger,
        })
      : undefined;
  approvalEngineActionProcessor?.start();

  // --- HTTP server with WS upgrade support ---
  const server =
    shouldRunEdge && app && wsHandler
      ? await (async () => {
          const listener = getRequestListener(app.fetch);
          const tlsSelfSigned = deploymentConfig.server.tlsSelfSigned ?? false;
          const { server: s, tlsMaterial } = await (async () => {
            if (!tlsSelfSigned) {
              return { server: createHttpServer(listener), tlsMaterial: null };
            }
            const material = await ensureSelfSignedTlsMaterial({ home: tyrumHome });
            return {
              server: createHttpsServer({ key: material.keyPem, cert: material.certPem }, listener),
              tlsMaterial: material,
            };
          })();

          s.on("upgrade", (req, socket, head) => {
            const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
            if (pathname === "/ws") {
              wsHandler.handleUpgrade(req, socket, head);
            } else {
              socket.destroy();
            }
          });

          s.listen(port, host, () => {
            const scheme = tlsSelfSigned ? "https" : "http";
            logger.info("gateway.listen", {
              host,
              port,
              url: `${scheme}://${host}:${port}`,
              tls_self_signed: tlsSelfSigned,
              tls_fingerprint256: tlsMaterial?.fingerprint256 ?? null,
            });

            if (tlsSelfSigned && tlsMaterial) {
              console.log("---");
              console.log(
                "TLS enabled (self-signed). Browsers will show a warning unless trusted.",
              );
              console.log(`TLS fingerprint (SHA-256): ${tlsMaterial.fingerprint256}`);
              console.log(`TLS certificate: ${tlsMaterial.certPath}`);
              console.log(`TLS key: ${tlsMaterial.keyPath}`);
              console.log(`UI: https://${host}:${port}/ui`);
              console.log(`WS: wss://${host}:${port}/ws`);
              console.log("Verify the fingerprint out-of-band (e.g. SSH) before trusting.");
              console.log("---");
            }
          });

          return s;
        })()
      : undefined;

  if (!shouldRunEdge) {
    console.log(`Tyrum gateway v${VERSION} started in role '${role}'.`);
  }

  if (hooksRuntime && shouldRunWorker) {
    void hooksRuntime
      .fire({
        event: "gateway.start",
        metadata: { instance_id: instanceId, role },
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("hooks.fire_failed", { event: "gateway.start", error: message });
      });
  }

  const workerLoop = shouldRunWorker
    ? (() => {
        const engine = new ExecutionEngine({
          db: container.db,
          redactionEngine: container.redactionEngine,
          secretProviderForTenant,
          policyService: container.policyService,
          logger,
        });

        const resolveExecutor = (): ExecutionStepExecutor => {
          const toolrunner = deploymentConfig.execution.toolrunner;
          if (toolrunner.launcher === "kubernetes") {
            if (!isPostgresDbUri(dbPath)) {
              throw new Error(
                "execution.toolrunner.launcher=kubernetes requires --db to be a Postgres URI",
              );
            }
            return createKubernetesToolRunnerStepExecutor({
              namespace: toolrunner.namespace,
              image: toolrunner.image,
              workspacePvcClaim: toolrunner.workspacePvcClaim,
              tyrumHome,
              dbPath,
              hardeningProfile: deploymentConfig.toolrunner.hardeningProfile,
              logger,
              jobTtlSeconds: 300,
            });
          }

          return createToolRunnerStepExecutor({
            entrypoint: fileURLToPath(import.meta.url),
            home: tyrumHome,
            dbPath,
            migrationsDir,
            logger,
          });
        };

        const toolExecutor = resolveExecutor() satisfies ExecutionStepExecutor;
        const nodeDispatchExecutor = createNodeDispatchStepExecutor({
          db: container.db,
          artifactStore: container.artifactStore,
          nodeDispatchService: new NodeDispatchService(protocolDeps),
          fallback: toolExecutor,
        }) satisfies ExecutionStepExecutor;
        const executor = createGatewayStepExecutor({
          container,
          toolExecutor: nodeDispatchExecutor,
        }) satisfies ExecutionStepExecutor;

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
    const shutdownStartedAtMs = Date.now();
    // Shutdown hooks may need to enqueue and start execution even when the worker
    // is busy finishing an in-flight step. Keep a hard cap to avoid hanging, but
    // allow enough time for CI and slower environments to drain.
    const hardExitTimeoutMs = 15_000;
    const hardExitDeadlineMs = shutdownStartedAtMs + hardExitTimeoutMs;

    const sleep = (ms: number): Promise<void> => {
      return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
    };

    const waitForRunsToStart = async (
      runIds: readonly string[],
      timeoutMs: number,
    ): Promise<void> => {
      if (runIds.length === 0) return;
      if (timeoutMs <= 0) return;
      const placeholders = runIds.map(() => "?").join(", ");
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const rows = await container.db.all<{ run_id: string; status: string }>(
          `SELECT run_id, status FROM execution_runs WHERE run_id IN (${placeholders})`,
          runIds,
        );
        const statusByRunId = new Map(rows.map((row) => [row.run_id, row.status]));
        const allStarted = runIds.every((runId) => {
          const status = statusByRunId.get(runId);
          return status !== undefined && status !== "queued";
        });
        if (allStarted) return;
        await sleep(50);
      }
    };

    const hardExitTimer = setTimeout(() => {
      console.warn("Gateway forced shutdown after 15 seconds.");
      process.exit(1);
    }, hardExitTimeoutMs);
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
    authRateLimiter?.stop();
    wsUpgradeRateLimiter?.stop();

    const shutdownHookRuns =
      hooksRuntime && shouldRunWorker
        ? hooksRuntime
            .fire({
              event: "gateway.shutdown",
              metadata: { signal, instance_id: instanceId, role },
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              logger.warn("hooks.fire_failed", { event: "gateway.shutdown", error: message });
              return [];
            })
        : Promise.resolve([]);

    const stopWorker = (async () => {
      if (!workerLoop) return;
      try {
        const runIds = await shutdownHookRuns;
        if (runIds.length > 0) {
          // Give the worker loop as much time as possible to pick up shutdown hooks before stopping.
          // If we stop too early (under load), shutdown hooks can remain queued and never run.
          const remainingMs = Math.max(0, hardExitDeadlineMs - Date.now() - 250);
          await waitForRunsToStart(runIds, remainingMs);
        }
      } finally {
        workerLoop.stop();
        await workerLoop.done;
      }
    })();

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
    artifactLifecycleScheduler?.stop();
    outboxLifecycleScheduler?.stop();
    stateStoreLifecycleScheduler?.stop();
    workSignalScheduler?.stop();
    outboxPoller?.stop();
    telegramProcessor?.stop();
    approvalEngineActionProcessor?.stop();
    container.modelsDev.stopBackgroundRefresh();

    void runShutdownCleanup(
      [
        closeServer,
        closeWss,
        shutdownHookRuns,
        agents?.shutdown() ?? Promise.resolve(),
        otel.shutdown(),
        stopWorker,
      ],
      () => container.db.close(),
    ).finally(() => {
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
      console.error(`error: ${formatFatalErrorForConsole(error)}`);
      process.exit(1);
    });
}
