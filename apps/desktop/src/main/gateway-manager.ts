import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GatewayBinSource } from "./gateway-bin-path.js";

export interface GatewayManagerOptions {
  gatewayBin: string;
  gatewayBinSource?: GatewayBinSource;
  port: number;
  dbPath: string;
  home?: string;
  /**
   * Deprecated: the gateway no longer accepts an externally-provided token at startup.
   * Use bootstrap tokens issued by the gateway and persist them in the desktop config.
   */
  accessToken?: string;
  host?: string;
}

type GatewayProcessOptions = Pick<
  GatewayManagerOptions,
  "gatewayBin" | "gatewayBinSource" | "dbPath" | "home"
>;

export interface GatewayLogEntry {
  level: "info" | "error";
  message: string;
  timestamp: string;
}

export type GatewayStatus = "stopped" | "starting" | "running" | "error";

export interface GatewayManagerEvents {
  log: [entry: GatewayLogEntry];
  exit: [code: number | null];
  "status-change": [status: GatewayStatus];
  "health-fail": [];
}

const STARTUP_FAILURE_PATTERNS = [
  /EADDRINUSE/i,
  /address already in use/i,
  /EACCES/i,
  /permission denied/i,
  /Cannot find package/i,
  /Cannot find module/i,
  /ERR_MODULE_NOT_FOUND/i,
];

const GENERIC_ERROR_PATTERNS = [/ERR_[A-Z0-9_]+/i, /\bError\b/i];

const STARTUP_NOISE_PATTERNS = [
  /^Node\.js v\d+/i,
  /^\^$/,
  /^at\s+/,
  /^node:internal\//,
  /^file:\/\/.+:\d+:\d+$/,
];

const STARTUP_LOG_BUFFER_LIMIT = 80;

const BOOTSTRAP_TOKEN_LINE_PATTERN =
  /^(?<prefix>.*?)(?<label>system|default-tenant-admin):\s*(?<token>tyrum-token\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?<suffix>\s*)$/;

function isStartupNoiseLine(line: string): boolean {
  return STARTUP_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

export function summarizeGatewayStartupFailure(startupLogLines: string[]): string | undefined {
  const normalizedLines = startupLogLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return undefined;
  }

  for (const pattern of STARTUP_FAILURE_PATTERNS) {
    const matched = normalizedLines.find((line) => pattern.test(line));
    if (matched) {
      return matched;
    }
  }

  for (const pattern of GENERIC_ERROR_PATTERNS) {
    const matched = normalizedLines.find((line) => pattern.test(line) && !isStartupNoiseLine(line));
    if (matched) {
      return matched;
    }
  }

  const meaningfulLines = normalizedLines.filter((line) => !isStartupNoiseLine(line));
  return meaningfulLines.at(-1);
}

function appendStartupLogLines(buffer: string[], rawOutput: string): void {
  const lines = rawOutput
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return;

  buffer.push(...lines);
  if (buffer.length > STARTUP_LOG_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - STARTUP_LOG_BUFFER_LIMIT);
  }
}

type BootstrapTokenChunkProcessor = {
  processChunk(chunk: string): string;
  flushRemainder(): string;
};

function createBootstrapTokenChunkProcessor(
  tokens: Map<string, string>,
): BootstrapTokenChunkProcessor {
  let remainder = "";

  const processLine = (rawLine: string): string => {
    const match = BOOTSTRAP_TOKEN_LINE_PATTERN.exec(rawLine);
    const prefix = match?.groups?.["prefix"] ?? "";
    const label = match?.groups?.["label"];
    const token = match?.groups?.["token"];
    const suffix = match?.groups?.["suffix"] ?? "";
    if (label && token) {
      tokens.set(label, token);
      return `${prefix}${label}: [REDACTED]${suffix}`;
    }
    return rawLine;
  };

  const processText = (text: string): { output: string; nextRemainder: string } => {
    const parts = text.split(/(\r?\n)/g);
    let output = "";
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const rawLine = parts[i] ?? "";
      const newline = parts[i + 1] ?? "";
      output += processLine(rawLine) + newline;
    }
    return { output, nextRemainder: parts.at(-1) ?? "" };
  };

  return {
    processChunk(chunk: string): string {
      const combined = remainder + chunk;
      const processed = processText(combined);
      remainder = processed.nextRemainder;
      return processed.output;
    },
    flushRemainder(): string {
      const pending = remainder;
      remainder = "";
      if (!pending) return "";
      return processLine(pending);
    },
  };
}

function inferHomeFromDbPath(dbPath: string): string | undefined {
  if (!dbPath || dbPath.includes("://")) return undefined;
  try {
    return dirname(dbPath);
  } catch {
    return undefined;
  }
}

function resolveGatewayMigrationsDir(gatewayBin: string): string | undefined {
  const gatewayDir = dirname(gatewayBin);
  const alongsideGateway = join(gatewayDir, "migrations");
  if (existsSync(alongsideGateway)) {
    const sqliteDir = join(alongsideGateway, "sqlite");
    return existsSync(sqliteDir) ? sqliteDir : alongsideGateway;
  }

  // Monorepo layout: packages/gateway/dist/index.mjs -> packages/gateway/migrations
  const monorepoMigrations = join(gatewayDir, "../migrations");
  if (existsSync(monorepoMigrations)) {
    const sqliteDir = join(monorepoMigrations, "sqlite");
    return existsSync(sqliteDir) ? sqliteDir : monorepoMigrations;
  }

  return undefined;
}

function buildGatewayDbArgs(opts: GatewayProcessOptions): string[] {
  const home = opts.home ?? inferHomeFromDbPath(opts.dbPath);
  const args: string[] = [];
  if (home) args.push("--home", home);
  args.push("--db", opts.dbPath);

  const migrationsDir = resolveGatewayMigrationsDir(opts.gatewayBin);
  if (migrationsDir) {
    args.push("--migrations-dir", migrationsDir);
  }

  return args;
}

function isElectronRuntime(versions: NodeJS.ProcessVersions = process.versions): boolean {
  return typeof versions.electron === "string" && versions.electron.length > 0;
}

function isMonorepoGatewayBundlePath(gatewayBin: string): boolean {
  return gatewayBin.replaceAll("\\", "/").includes("/packages/gateway/dist/");
}

function resolveNodeCommand(env: NodeJS.ProcessEnv = process.env): string {
  const preferredNode =
    env["TYRUM_DESKTOP_NODE_EXEC_PATH"]?.trim() ||
    env["npm_node_execpath"]?.trim() ||
    env["VOLTA_NODE"]?.trim();
  return preferredNode || "node";
}

export interface GatewayLaunchCommand {
  command: string;
  env: Record<string, string>;
}

export function resolveGatewayLaunchCommand(options: {
  gatewayBin: string;
  gatewayBinSource?: GatewayBinSource;
  processExecPath?: string;
  versions?: NodeJS.ProcessVersions;
  env?: NodeJS.ProcessEnv;
}): GatewayLaunchCommand {
  const processExecPath = options.processExecPath ?? process.execPath;
  const versions = options.versions ?? process.versions;
  const env = options.env ?? process.env;

  if (!isElectronRuntime(versions)) {
    return { command: processExecPath, env: {} };
  }

  if (options.gatewayBinSource === "monorepo") {
    return { command: resolveNodeCommand(env), env: {} };
  }

  // The staged desktop gateway bundle is produced by build:gateway, which
  // rebuilds native modules like better-sqlite3 against Electron.
  if (options.gatewayBinSource === "staged") {
    return {
      command: processExecPath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  // In development, the repo-local monorepo gateway bundle resolves native
  // modules from the workspace install, which is built for Node rather than
  // the Electron runtime used by the desktop shell.
  if (!options.gatewayBinSource && isMonorepoGatewayBundlePath(options.gatewayBin)) {
    return { command: resolveNodeCommand(env), env: {} };
  }

  return {
    command: processExecPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

export class GatewayManager extends EventEmitter<GatewayManagerEvents> {
  private process: ChildProcess | null = null;
  private stoppingProcess: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private _status: GatewayStatus = "stopped";
  private bootstrapTokens = new Map<string, string>();

  get status(): GatewayStatus {
    return this._status;
  }

  getBootstrapToken(label: string): string | undefined {
    return this.bootstrapTokens.get(label);
  }

  private setStatus(status: GatewayStatus): void {
    this._status = status;
    this.emit("status-change", status);
  }

  async issueDefaultTenantAdminToken(opts: GatewayProcessOptions): Promise<string> {
    const startupLogLines: string[] = [];
    const tokens = new Map<string, string>();
    const launch = resolveGatewayLaunchCommand({
      gatewayBin: opts.gatewayBin,
      gatewayBinSource: opts.gatewayBinSource,
    });
    const args = [
      opts.gatewayBin,
      "tokens",
      "issue-default-tenant-admin",
      ...buildGatewayDbArgs(opts),
    ];
    const proc = spawn(launch.command, args, {
      env: {
        ...process.env,
        ...launch.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutProcessor = createBootstrapTokenChunkProcessor(tokens);
    const stderrProcessor = createBootstrapTokenChunkProcessor(tokens);

    proc.stdout?.on("data", (data: Buffer) => {
      const redacted = stdoutProcessor.processChunk(data.toString());
      if (redacted) {
        appendStartupLogLines(startupLogLines, redacted);
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const redacted = stderrProcessor.processChunk(data.toString());
      if (redacted) {
        appendStartupLogLines(startupLogLines, redacted);
      }
    });

    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        proc.once("error", reject);
        proc.once("exit", (code, signal) => {
          const stdoutFlush = stdoutProcessor.flushRemainder();
          if (stdoutFlush) {
            appendStartupLogLines(startupLogLines, stdoutFlush);
          }
          const stderrFlush = stderrProcessor.flushRemainder();
          if (stderrFlush) {
            appendStartupLogLines(startupLogLines, stderrFlush);
          }
          resolve({ code, signal });
        });
      },
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gateway token recovery command failed to launch: ${message}`);
    });

    if (exit.code !== 0 || exit.signal !== null) {
      const reason =
        summarizeGatewayStartupFailure(startupLogLines) ??
        `process exited (code ${String(exit.code)}, signal ${String(exit.signal)})`;
      throw new Error(`Gateway token recovery command failed: ${reason}`);
    }

    const token = tokens.get("default-tenant-admin")?.trim();
    if (!token) {
      throw new Error(
        "Gateway token recovery command completed without returning a default-tenant-admin token.",
      );
    }
    return token;
  }

  async start(opts: GatewayManagerOptions): Promise<void> {
    if (this.process) throw new Error("Gateway already running");
    this.setStatus("starting");
    this.bootstrapTokens.clear();

    const host = opts.host ?? "127.0.0.1";
    const startupLogLines: string[] = [];
    const args: string[] = [
      opts.gatewayBin,
      "start",
      "--host",
      host,
      "--port",
      String(opts.port),
      ...buildGatewayDbArgs(opts),
    ];

    const launch = resolveGatewayLaunchCommand({
      gatewayBin: opts.gatewayBin,
      gatewayBinSource: opts.gatewayBinSource,
    });
    const proc = spawn(launch.command, args, {
      env: {
        ...process.env,
        ...launch.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = proc;

    const stdoutProcessor = createBootstrapTokenChunkProcessor(this.bootstrapTokens);
    const stderrProcessor = createBootstrapTokenChunkProcessor(this.bootstrapTokens);

    proc.stdout?.on("data", (data: Buffer) => {
      const redacted = stdoutProcessor.processChunk(data.toString());
      if (!redacted) return;
      appendStartupLogLines(startupLogLines, redacted);
      this.emit("log", {
        level: "info",
        message: redacted.trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const redacted = stderrProcessor.processChunk(data.toString());
      if (!redacted) return;
      appendStartupLogLines(startupLogLines, redacted);
      this.emit("log", {
        level: "error",
        message: redacted.trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    proc.on("exit", (code) => {
      const stdoutFlush = stdoutProcessor.flushRemainder();
      if (stdoutFlush) {
        appendStartupLogLines(startupLogLines, stdoutFlush);
        this.emit("log", {
          level: "info",
          message: stdoutFlush.trimEnd(),
          timestamp: new Date().toISOString(),
        });
      }

      const stderrFlush = stderrProcessor.flushRemainder();
      if (stderrFlush) {
        appendStartupLogLines(startupLogLines, stderrFlush);
        this.emit("log", {
          level: "error",
          message: stderrFlush.trimEnd(),
          timestamp: new Date().toISOString(),
        });
      }

      const isGracefulStop = this.stoppingProcess === proc;
      if (isGracefulStop) {
        this.stoppingProcess = null;
      } else {
        this.setStatus(code === 0 ? "stopped" : "error");
      }

      this.emit("exit", code);

      // Avoid clobbering a newer process if one was started before this exit fired.
      if (this.process === proc) {
        this.process = null;
        this.stopHealthCheck();
      }
    });

    await this.waitForHealth(proc, opts.port, host, startupLogLines);
    if (this.process !== proc || proc.exitCode !== null || proc.signalCode !== null) {
      const startupReason = summarizeGatewayStartupFailure(startupLogLines);
      const processReason = `process exited (code ${String(proc.exitCode)}, signal ${String(proc.signalCode)})`;
      const reason = startupReason ?? processReason;
      throw new Error(`Gateway failed to start: ${reason}`);
    }
    this.setStatus("running");
    this.startHealthCheck(opts.port, host);
  }

  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) return;

    // Prevent concurrent stop() from double-killing
    this.process = null;
    this.stopHealthCheck();

    // If the process already exited, just clean up
    if (proc.exitCode !== null || proc.signalCode !== null) {
      this.setStatus("stopped");
      return;
    }

    this.stoppingProcess = proc;

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        if (this.status !== "stopped") {
          this.setStatus("stopped");
        }
        resolve();
      }, 5_000);
      killTimer.unref();

      proc.once("exit", () => {
        clearTimeout(killTimer);
        if (this.stoppingProcess === proc) {
          this.stoppingProcess = null;
        }
        this.setStatus("stopped");
        resolve();
      });

      try {
        proc.kill("SIGTERM");
      } catch {
        // Process already exited (ESRCH) — exit event will fire or already fired.
        // If it already fired before we attached our listener, resolve now.
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearTimeout(killTimer);
          if (this.stoppingProcess === proc) {
            this.stoppingProcess = null;
          }
          this.setStatus("stopped");
          resolve();
        }
      }
    });
  }

  private async waitForHealth(
    proc: ChildProcess,
    port: number,
    host: string,
    startupLogLines: string[],
    maxAttempts = process.platform === "win32" || process.platform === "darwin" ? 150 : 30,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (this.process !== proc || proc.exitCode !== null || proc.signalCode !== null) {
        this.process = null;
        this.setStatus("error");
        const startupReason = summarizeGatewayStartupFailure(startupLogLines);
        const processReason = `process exited (code ${String(proc.exitCode)}, signal ${String(proc.signalCode)})`;
        const reason = startupReason ?? processReason;
        throw new Error(`Gateway failed to start: ${reason}`);
      }

      try {
        const res = await fetch(`http://${host}:${port}/healthz`);
        if (res.ok) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      proc.kill("SIGKILL");
    } catch {
      /* process already exited */
    }
    this.process = null;
    this.setStatus("error");
    const startupReason = summarizeGatewayStartupFailure(startupLogLines);
    if (startupReason) {
      throw new Error(`Gateway failed to start within timeout: ${startupReason}`);
    }
    throw new Error("Gateway failed to start within timeout");
  }

  private startHealthCheck(port: number, host: string): void {
    this.healthTimer = setInterval(async () => {
      const observedProcess = this.process;
      if (!observedProcess) return;

      try {
        const res = await fetch(`http://${host}:${port}/healthz`);
        if (this.process !== observedProcess) return;

        if (res.ok) {
          if (this.status === "error") {
            this.setStatus("running");
          }
          return;
        }

        this.setStatus("error");
        this.emit("health-fail");
      } catch {
        if (this.process !== observedProcess) return;

        this.setStatus("error");
        this.emit("health-fail");
      }
    }, 10_000);
    this.healthTimer.unref();
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
