import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GatewayManagerOptions {
  gatewayBin: string;
  port: number;
  dbPath: string;
  accessToken: string;
  host?: string;
}

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

function isStartupNoiseLine(line: string): boolean {
  return STARTUP_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

export function summarizeGatewayStartupFailure(
  startupLogLines: string[],
): string | undefined {
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
    const matched = normalizedLines.find(
      (line) => pattern.test(line) && !isStartupNoiseLine(line),
    );
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

export class GatewayManager extends EventEmitter<GatewayManagerEvents> {
  private process: ChildProcess | null = null;
  private stoppingProcess: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private _status: GatewayStatus = "stopped";

  get status(): GatewayStatus {
    return this._status;
  }

  private setStatus(status: GatewayStatus): void {
    this._status = status;
    this.emit("status-change", status);
  }

  async start(opts: GatewayManagerOptions): Promise<void> {
    if (this.process) throw new Error("Gateway already running");
    this.setStatus("starting");

    const host = opts.host ?? "127.0.0.1";
    const gatewayDir = dirname(opts.gatewayBin);
    const migrationsDir = (() => {
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
    })();
    const startupLogLines: string[] = [];

    const proc = spawn(process.execPath, [opts.gatewayBin], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GATEWAY_PORT: String(opts.port),
        GATEWAY_HOST: host,
        GATEWAY_DB_PATH: opts.dbPath,
        GATEWAY_TOKEN: opts.accessToken,
        ...(migrationsDir ? { GATEWAY_MIGRATIONS_DIR: migrationsDir } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = proc;

    proc.stdout?.on("data", (data: Buffer) => {
      appendStartupLogLines(startupLogLines, data.toString());
      this.emit("log", {
        level: "info",
        message: data.toString().trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      appendStartupLogLines(startupLogLines, data.toString());
      this.emit("log", {
        level: "error",
        message: data.toString().trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    proc.on("exit", (code) => {
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
    maxAttempts = 30,
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
