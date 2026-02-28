/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { PluginManifest } from "@tyrum/schemas";
import { createContainerAsync } from "./container.js";
import { createApp } from "./app.js";
import { isAgentEnabled } from "./modules/agent/enabled.js";
import { TokenStore } from "./modules/auth/token-store.js";
import { WatcherScheduler } from "./modules/watcher/scheduler.js";
import { WorkSignalScheduler } from "./modules/workboard/signal-scheduler.js";
import {
  createSecretProviderFromEnv,
  resolveSecretProviderKind,
} from "./modules/secret/create-secret-provider.js";
import { ArtifactLifecycleScheduler } from "./modules/artifact/lifecycle.js";
import { WsNotifier } from "./modules/approval/notifier.js";
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
import { MemoryV1Dal } from "./modules/memory/v1-dal.js";
import {
  ExecutionEngine,
  type StepExecutor as ExecutionStepExecutor,
} from "./modules/execution/engine.js";
import { startExecutionWorkerLoop } from "./modules/execution/worker-loop.js";
import { isChannelPipelineEnabled, TelegramChannelProcessor } from "./modules/channels/telegram.js";
import { createToolRunnerStepExecutor } from "./modules/execution/toolrunner-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "./modules/execution/kubernetes-toolrunner-step-executor.js";
import { createGatewayStepExecutor } from "./modules/execution/gateway-step-executor.js";
import { runToolRunnerFromStdio } from "./toolrunner.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";
import { VERSION } from "./version.js";
import { resolveUserTyrumHome } from "./modules/agent/home.js";
import { loadAgentConfig } from "./modules/agent/workspace.js";
import { PluginRegistry, resolveBundledPluginsDirFrom } from "./modules/plugins/registry.js";
import { installPluginFromDir } from "./modules/plugins/installer.js";
import { AgentRegistry } from "./modules/agent/registry.js";
import { isRecord, parseJsonOrYaml } from "./utils/parse-json-or-yaml.js";
import { loadLifecycleHooksFromHome } from "./modules/hooks/config.js";
import { LifecycleHooksRuntime } from "./modules/hooks/runtime.js";

// Re-export for library consumers
export { VERSION } from "./version.js";
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

export function formatFatalErrorForConsole(error: unknown): string {
  void error;
  return "Error";
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

function isTruthyEnvFlag(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return false;
  return !["0", "false", "off", "no"].includes(trimmed);
}

export function assertNonLoopbackDeploymentGuardrails(input: {
  role: GatewayRole;
  host: string;
  token: string | undefined;
}): NonLoopbackTransportPolicy {
  const shouldRunEdge = input.role === "all" || input.role === "edge";
  if (!shouldRunEdge) return "local";

  const hostSplit = splitHostAndPort(input.host);
  const hostForLoopback = hostSplit.host.length > 0 ? hostSplit.host : input.host;
  const isLocalOnly = isLoopbackHost(hostForLoopback);
  if (isLocalOnly) return "local";

  const token = input.token?.trim() ?? "";
  if (token.length === 0) {
    throw new Error(
      "Gateway is exposed beyond loopback but no admin token is configured. " +
        "Set GATEWAY_TOKEN (recommended) or provide a non-empty TYRUM_HOME/.admin-token file.",
    );
  }

  const minTokenLength = 32;
  if (token.length < minTokenLength) {
    throw new Error(
      `Gateway is exposed beyond loopback but the admin token is too short (${token.length}). ` +
        `Set GATEWAY_TOKEN to a high-entropy secret of at least ${minTokenLength} characters.`,
    );
  }

  const tlsReady = isTruthyEnvFlag(process.env["TYRUM_TLS_READY"]);
  if (tlsReady) return "tls";

  const allowInsecureHttp = isTruthyEnvFlag(process.env["TYRUM_ALLOW_INSECURE_HTTP"]);
  if (allowInsecureHttp) return "insecure";

  throw new Error(
    "Gateway is configured to bind to a non-loopback address. Remote operation requires TLS. " +
      "Set TYRUM_TLS_READY=1 after configuring TLS termination (recommended), " +
      "or set TYRUM_ALLOW_INSECURE_HTTP=1 to acknowledge and allow plaintext HTTP in a trusted network.",
  );
}

type CliCommand =
  | { kind: "start"; role: GatewayRole }
  | { kind: "check" }
  | { kind: "toolrunner" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "update"; channel: UpdateChannel; version?: string }
  | { kind: "plugin_install"; source_dir: string; home?: string };

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
  tyrum check
  tyrum toolrunner
  tyrum plugin install <dir> [--home <path>]
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
  if (first === "check") return { kind: "check" };
  if (first === "toolrunner") return { kind: "toolrunner" };

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

type AdminTokenSource = "env" | "file" | "generated";

type PortInfo = { port: number; raw: string; valid: boolean };

function resolveGatewayHost(): string {
  return process.env["GATEWAY_HOST"]?.trim() || "127.0.0.1";
}

function parsePort(raw: string): PortInfo {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { port: Number.NaN, raw, valid: false };
  }
  const parsed = Number(trimmed);
  const valid = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535;
  return { port: parsed, raw, valid };
}

function resolveGatewayPort(): PortInfo {
  const raw = process.env["GATEWAY_PORT"] ?? "8788";
  return parsePort(raw);
}

function splitHostAndPort(rawHost: string): { host: string; port: string | null } {
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
  // when a user configures GATEWAY_HOST="::1:8788".
  if (firstColon !== -1 && firstColon !== lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = trimmed.slice(lastColon + 1);
    if (host.length > 0 && /^[0-9]+$/.test(port) && isIP(host) === 6) {
      return { host, port };
    }
  }

  return { host: trimmed, port: null };
}

function normalizeProbeHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed === "0.0.0.0") return "127.0.0.1";
  if (trimmed === "::") return "::1";
  return trimmed;
}

function hostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

async function loadPluginManifestFromDir(
  dir: string,
): Promise<
  | { kind: "missing" }
  | { kind: "invalid"; error: string }
  | { kind: "ok"; manifest: { id: string; name: string; version: string } }
> {
  const candidates = ["plugin.yml", "plugin.yaml", "plugin.json"];
  for (const filename of candidates) {
    const path = join(dir, filename);
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      continue;
    }

    try {
      const parsed = parseJsonOrYaml(raw, path);
      if (!isRecord(parsed)) {
        return { kind: "invalid", error: "manifest must be an object" };
      }
      const manifest = PluginManifest.parse(parsed);
      const missingFields: string[] = [];
      if (!manifest.entry) missingFields.push("entry");
      if (!manifest.contributes) missingFields.push("contributes");
      if (!manifest.permissions) missingFields.push("permissions");
      if (missingFields.length > 0) {
        return {
          kind: "invalid",
          error: `missing required manifest field(s): ${missingFields.join(", ")}`,
        };
      }
      return {
        kind: "ok",
        manifest: { id: manifest.id, name: manifest.name, version: manifest.version },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "invalid", error: message };
    }
  }
  return { kind: "missing" };
}

async function discoverPluginsInDir(dir: string): Promise<{
  plugins: Array<{ id: string; name: string; version: string }>;
  invalid_manifests: number;
}> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { plugins: [], invalid_manifests: 0 };
  }

  const plugins: Array<{ id: string; name: string; version: string }> = [];
  let invalidManifests = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(dir, entry.name);
    const result = await loadPluginManifestFromDir(pluginDir);
    if (result.kind === "ok") {
      plugins.push(result.manifest);
    } else if (result.kind === "invalid") {
      invalidManifests += 1;
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, invalid_manifests: invalidManifests };
}

function shortHash(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 12);
}

async function resolveAdminTokenForCheck(tyrumHome: string): Promise<{
  source: AdminTokenSource;
  token: string | undefined;
}> {
  const envToken = process.env["GATEWAY_TOKEN"]?.trim();
  if (envToken && envToken.length > 0) {
    return { source: "env", token: envToken };
  }

  const tokenPath = join(tyrumHome, ".admin-token");
  try {
    const raw = await readFile(tokenPath, "utf-8");
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return { source: "file", token: trimmed };
    }
  } catch {
    // ignore
  }

  return { source: "generated", token: undefined };
}

async function tryFetchJson(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
  error?: string;
}> {
  const { timeoutMs, ...requestInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = text;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, json: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function runGatewayCheck(): Promise<number> {
  const dbPath = process.env["GATEWAY_DB_PATH"] ?? "gateway.db";
  const defaultMigrationsDir = isPostgresDbUri(dbPath)
    ? join(__dirname, "../migrations/postgres")
    : join(__dirname, "../migrations/sqlite");
  const migrationsDir = process.env["GATEWAY_MIGRATIONS_DIR"] ?? defaultMigrationsDir;
  const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");

  let container: Awaited<ReturnType<typeof createContainerAsync>> | undefined;
  try {
    ensureDatabaseDirectory(dbPath);

    container = await createContainerAsync({
      dbPath,
      migrationsDir,
      tyrumHome,
    });

    const models = await container.modelsDev.ensureLoaded();
    await container.oauthProviderRegistry.list();

    console.log("check: ok");
    console.log(
      `models.dev: source=${models.status.source} providers=${models.status.provider_count} models=${models.status.model_count}`,
    );
    if (models.status.last_error) {
      console.log("models.dev: last_error=present");
    }
    console.log("oauth: providers_configured=loaded");

    // --- Static diagnostics ---
    const hostRaw = resolveGatewayHost();
    const hostSplit = splitHostAndPort(hostRaw);
    const hostForProbe = hostSplit.host.length > 0 ? hostSplit.host : hostRaw;
    const portInfo = resolveGatewayPort();
    const isLocalOnly = isLoopbackHost(hostForProbe);
    console.log(
      `static.exposure: host=${hostRaw} port=${portInfo.valid ? portInfo.port : `invalid(raw=${portInfo.raw})`} is_exposed=${!isLocalOnly}`,
    );

    const tokenPath = join(tyrumHome, ".admin-token");
    const adminToken = await resolveAdminTokenForCheck(tyrumHome);
    console.log(`static.auth: admin_token_source=${adminToken.source} token_path=${tokenPath}`);
    const token = adminToken.token;

    try {
      const policy = await container.policyService?.getStatus?.();
      if (policy) {
        console.log(
          `static.policy: enabled=${policy.enabled} observe_only=${policy.observe_only} sha256=${shortHash(policy.effective_sha256)} deployment=${policy.sources.deployment} agent=${policy.sources.agent ?? "none"}`,
        );
      } else {
        console.log("static.policy: unavailable");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`static.policy: error=${message}`);
    }

    try {
      const userHome = resolveUserTyrumHome();
      const bundledDir = resolveBundledPluginsDirFrom(__dirname);

      const workspaceDir = join(tyrumHome, "plugins");
      const userDir = join(userHome, "plugins");

      const [workspacePlugins, userPlugins, bundledPlugins] = await Promise.all([
        discoverPluginsInDir(workspaceDir),
        discoverPluginsInDir(userDir),
        discoverPluginsInDir(bundledDir),
      ]);

      console.log(
        `static.plugins: manifests=workspace:${workspacePlugins.plugins.length} user:${userPlugins.plugins.length} bundled:${bundledPlugins.plugins.length} invalid=${workspacePlugins.invalid_manifests + userPlugins.invalid_manifests + bundledPlugins.invalid_manifests}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`static.plugins: error=${message}`);
    }

    const secretProviderKind = resolveSecretProviderKind();
    try {
      const secretProvider = await createSecretProviderFromEnv(tyrumHome, token);
      const handles = await secretProvider.list();
      console.log(`static.secrets: provider=${secretProviderKind} handles=${handles.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`static.secrets: provider=${secretProviderKind} error=${message}`);
    }

    // --- Live HTTP probes (best-effort) ---
    try {
      if (!portInfo.valid) {
        console.log(`live.http: skipped=invalid_port raw=${portInfo.raw}`);
        return 0;
      }

      if (hostSplit.port) {
        console.log(
          `live.http: skipped=host_includes_port raw_host=${hostRaw} ignored_port=${hostSplit.port}`,
        );
        return 0;
      }

      const probeHost = normalizeProbeHost(hostForProbe);
      const baseUrl = `http://${hostForUrl(probeHost)}:${portInfo.port}`;
      const health = await tryFetchJson(`${baseUrl}/healthz`, { timeoutMs: 500 });
      const statusPublic = await tryFetchJson(`${baseUrl}/status`, { timeoutMs: 500 });

      const isLoopbackProbeTarget = isLoopbackHost(probeHost);
      const statusAuth =
        isLoopbackProbeTarget && token
          ? await tryFetchJson(`${baseUrl}/status`, {
              timeoutMs: 500,
              headers: {
                authorization: `Bearer ${token}`,
              },
            })
          : null;

      const healthOk =
        health.ok && isRecord(health.json) && (health.json["status"] as unknown) === "ok";
      const statusPublicOk =
        statusPublic.ok &&
        isRecord(statusPublic.json) &&
        (statusPublic.json["status"] as unknown) === "ok";
      const statusAuthOk =
        statusAuth?.ok &&
        isRecord(statusAuth.json) &&
        (statusAuth.json["status"] as unknown) === "ok";

      const formatProbe = (probe: { ok: boolean; status: number } | null, ok: boolean): string => {
        if (!probe) return "skipped";
        if (probe.status === 0) return "unavailable";
        if (ok) return "ok";
        if (probe.status === 401) return "unauthorized";
        return `fail(${probe.status})`;
      };

      console.log(
        `live.http: base=${baseUrl} healthz=${formatProbe(health, healthOk)} status_public=${formatProbe(statusPublic, statusPublicOk)} status_auth=${formatProbe(statusAuth, Boolean(statusAuthOk))}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`live.http: error=${message}`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`check: failed: ${message}`);
    return 1;
  } finally {
    if (container) {
      await container.db.close().catch((closeErr) => {
        const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
        console.error(`check: warning: failed to close db: ${message}`);
      });
    }
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
    return await runGatewayCheck();
  }

  if (command.kind === "toolrunner") {
    return runToolRunnerFromStdio();
  }

  if (command.kind === "plugin_install") {
    const tyrumHome = command.home ?? process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
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
  const migrationsDir = process.env["GATEWAY_MIGRATIONS_DIR"] ?? defaultMigrationsDir;

  const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  const isLocalOnly = isLoopbackHost(host);

  const instanceId = (() => {
    const raw = process.env["TYRUM_INSTANCE_ID"];
    const trimmed = raw?.trim();
    if (trimmed) {
      process.env["TYRUM_INSTANCE_ID"] = trimmed;
      return trimmed;
    }
    const generated = `gw-${crypto.randomUUID()}`;
    process.env["TYRUM_INSTANCE_ID"] = generated;
    return generated;
  })();

  ensureDatabaseDirectory(dbPath);

  const container = await createContainerAsync({
    dbPath,
    migrationsDir,
    tyrumHome,
  });
  container.modelsDev.startBackgroundRefresh();

  const logger = container.logger.child({
    role,
    instance_id: instanceId,
    version: VERSION,
  });
  logger.info("gateway.instance", { instance_id: instanceId });

  // Initialize auth token store
  const tokenStore = new TokenStore(tyrumHome);
  const token = await tokenStore.initialize();

  const transportPolicy = assertNonLoopbackDeploymentGuardrails({ role, host, token });

  if (transportPolicy !== "local") {
    const tokenPath = join(tyrumHome, ".admin-token");
    console.log("---");
    console.log("Gateway is exposed on a non-local interface.");
    console.log(`Admin token stored at: ${tokenPath}`);
    console.log("Read it with: cat " + tokenPath);
    if (transportPolicy === "insecure") {
      console.log("WARNING: TYRUM_ALLOW_INSECURE_HTTP=1 is set; plaintext HTTP is allowed.");
      console.log("Configure TLS termination and set TYRUM_TLS_READY=1 for remote access.");
    }
    console.log("---");
  }

  // Initialize secret provider (defaults per ADR-0007; override via TYRUM_SECRET_PROVIDER)
  const secretProvider = await createSecretProviderFromEnv(tyrumHome, token);

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
          memoryDal: container.memoryDal,
          eventBus: container.eventBus,
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
  });
  if (otel.enabled) {
    logger.info("otel.started");
  }

  const engineApiEnabled = isTruthyEnvFlag(process.env["TYRUM_ENGINE_API_ENABLED"]);

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
  const edgeEngine =
    shouldRunEdge && engineApiEnabled
      ? new ExecutionEngine({
          db: container.db,
          redactionEngine: container.redactionEngine,
          secretProvider,
          policyService: container.policyService,
          logger,
        })
      : undefined;

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
    evidence: unknown,
    error: string | undefined,
  ): TaskResult => {
    if (success) {
      return evidence === undefined ? { ok: true } : { ok: true, evidence };
    }
    const result: TaskResult = { ok: false, error: error ?? "task failed" };
    if (evidence !== undefined) {
      result.evidence = evidence;
    }
    return result;
  };
  const protocolDeps: ProtocolDeps = {
    connectionManager,
    logger,
    db: container.db,
    redactionEngine: container.redactionEngine,
    memoryV1Dal: new MemoryV1Dal(container.db),
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
    cluster: shouldRunEdge
      ? {
          edgeId: instanceId,
          outboxDal,
          connectionDirectory,
        }
      : undefined,
    taskResults,
    hooks: hooksRuntime,
    onTaskResult: (taskId, success, evidence, error) => {
      taskResults.resolve(taskId, toTaskResult(success, evidence, error));
    },
    onConnectionClosed: (connectionId) => {
      taskResults.rejectAllForConnection(connectionId);
    },
    onApprovalDecision: (approvalId: number, approved: boolean, reason: string | undefined) => {
      void container.approvalDal
        .respond(approvalId, approved, reason)
        .then(async (row) => {
          const desiredStatus = approved ? "approved" : "denied";
          const decisionMatches = row?.status === desiredStatus;

          logger.info("approval.decided", {
            approval_id: approvalId,
            approved,
            status: row?.status ?? "missing",
            reason,
            decision_matches: decisionMatches,
          });

          if (!row || !decisionMatches || !protocolDeps.engine) {
            return;
          }

          try {
            const isAgentToolExecution =
              isRecord(row.context) && row.context["source"] === "agent-tool-execution";
            const resumeToken = row.resume_token?.trim();

            if (row.status === "approved") {
              if (resumeToken) {
                await protocolDeps.engine.resumeRun(resumeToken);
              } else if (row.run_id) {
                await protocolDeps.engine.cancelRun(
                  row.run_id,
                  row.response_reason ?? reason ?? "approved approval missing resume token",
                );
              }
            } else if (row.status === "denied") {
              if (isAgentToolExecution && resumeToken) {
                await protocolDeps.engine.resumeRun(resumeToken);
              } else if (row.run_id) {
                await protocolDeps.engine.cancelRun(
                  row.run_id,
                  row.response_reason ?? reason ?? "approval denied",
                );
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error("approval.engine_action_failed", {
              approval_id: approvalId,
              approved,
              run_id: row.run_id,
              error: message,
            });
          }
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
        userHome: resolveUserTyrumHome(),
        logger,
        container,
      })
    : undefined;
  protocolDeps.plugins = plugins;

  const agents =
    shouldRunEdge && isAgentEnabled()
      ? new AgentRegistry({
          container,
          baseHome: tyrumHome,
          defaultSecretProvider: secretProvider,
          defaultPolicyService: container.policyService,
          approvalNotifier,
          plugins,
          logger,
        })
      : undefined;
  protocolDeps.agents = agents;
  protocolDeps.memoryV1BudgetsProvider = async (agentId?: string) => {
    const id = agentId?.trim() || "default";
    const home = agents ? agents.resolveAgentHome(id) : tyrumHome;
    const config = await loadAgentConfig(home);
    return config.memory.v1.budgets;
  };

  const app = shouldRunEdge
    ? createApp(container, {
        agents,
        plugins,
        tokenStore,
        secretProvider,
        isLocalOnly,
        connectionManager,
        connectionDirectory,
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
        tokenStore,
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
    shouldRunEdge && agents && container.telegramBot && isChannelPipelineEnabled()
      ? new TelegramChannelProcessor({
          db: container.db,
          agents,
          telegramBot: container.telegramBot,
          owner: instanceId,
          logger,
          memoryDal: container.memoryDal,
          approvalDal: container.approvalDal,
          approvalNotifier,
        })
      : undefined;
  telegramProcessor?.start();

  // --- HTTP server with WS upgrade support ---
  const server =
    shouldRunEdge && app && wsHandler
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
          secretProvider,
          policyService: container.policyService,
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
              throw new Error(
                "TYRUM_TOOLRUNNER_IMAGE is required when TYRUM_TOOLRUNNER_LAUNCHER=kubernetes",
              );
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

        const toolExecutor = resolveExecutor() satisfies ExecutionStepExecutor;
        const executor = createGatewayStepExecutor({
          container,
          toolExecutor,
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
