import { EventEmitter } from "node:events";
import { launchDesktopSubprocess, type DesktopSubprocess } from "./desktop-subprocess.js";
import {
  applyGatewayCliArgs,
  buildGatewayDbArgs,
  resolveGatewayLaunchSpec,
  type GatewayProcessOptions,
} from "./gateway-launch-spec.js";
import {
  appendGatewayStartupLogLines,
  createGatewayBootstrapTokenChunkProcessor,
  summarizeGatewayStartupFailure,
} from "./gateway-startup-logs.js";

export interface GatewayManagerOptions {
  gatewayBin: string;
  gatewayBinSource?: import("./gateway-bin-path.js").GatewayBinSource;
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

export { resolveGatewayLaunchSpec } from "./gateway-launch-spec.js";
export { summarizeGatewayStartupFailure } from "./gateway-startup-logs.js";

export class GatewayManager extends EventEmitter<GatewayManagerEvents> {
  private process: DesktopSubprocess | null = null;
  private startInFlight = false;
  private stoppingProcess: DesktopSubprocess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private _status: GatewayStatus = "stopped";
  private bootstrapTokens = new Map<string, string>();

  private emitLog(level: GatewayLogEntry["level"], message: string): void {
    this.emit("log", {
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  }

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
    const cliArgs = ["tokens", "issue-default-tenant-admin", ...buildGatewayDbArgs(opts)];
    const launch = applyGatewayCliArgs(
      resolveGatewayLaunchSpec({
        gatewayBin: opts.gatewayBin,
        gatewayBinSource: opts.gatewayBinSource,
      }),
      opts.gatewayBin,
      cliArgs,
    );
    const proc = await launchDesktopSubprocess(launch);

    const stdoutProcessor = createGatewayBootstrapTokenChunkProcessor(tokens);
    const stderrProcessor = createGatewayBootstrapTokenChunkProcessor(tokens);

    proc.stdout?.on("data", (data: Buffer) => {
      const redacted = stdoutProcessor.processChunk(data.toString());
      if (redacted) {
        appendGatewayStartupLogLines(startupLogLines, redacted);
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const redacted = stderrProcessor.processChunk(data.toString());
      if (redacted) {
        appendGatewayStartupLogLines(startupLogLines, redacted);
      }
    });

    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        proc.onceError(reject);
        proc.onceComplete((code, signal) => {
          const stdoutFlush = stdoutProcessor.flushRemainder();
          if (stdoutFlush) {
            appendGatewayStartupLogLines(startupLogLines, stdoutFlush);
          }
          const stderrFlush = stderrProcessor.flushRemainder();
          if (stderrFlush) {
            appendGatewayStartupLogLines(startupLogLines, stderrFlush);
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
    if (this.process || this.startInFlight) {
      throw new Error("Gateway already running");
    }

    this.startInFlight = true;
    try {
      this.setStatus("starting");
      this.bootstrapTokens.clear();
      this.emitLog(
        "info",
        `embedded-gateway bundle: source=${opts.gatewayBinSource ?? "unknown"} path=${opts.gatewayBin}`,
      );

      const host = opts.host ?? "127.0.0.1";
      const startupLogLines: string[] = [];
      const cliArgs: string[] = [
        "start",
        "--host",
        host,
        "--port",
        String(opts.port),
        ...buildGatewayDbArgs(opts),
      ];

      const launch = applyGatewayCliArgs(
        resolveGatewayLaunchSpec({
          gatewayBin: opts.gatewayBin,
          gatewayBinSource: opts.gatewayBinSource,
        }),
        opts.gatewayBin,
        cliArgs,
      );
      const proc = await launchDesktopSubprocess({
        ...launch,
        env: {
          ...launch.env,
          TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE: opts.gatewayBinSource ?? "",
        },
      });
      this.process = proc;
      this.emitLog(
        "info",
        launch.kind === "utility"
          ? `embedded-gateway launch: mode=utility module=${launch.modulePath}`
          : `embedded-gateway launch: mode=node command=${launch.command}`,
      );

      const stdoutProcessor = createGatewayBootstrapTokenChunkProcessor(this.bootstrapTokens);
      const stderrProcessor = createGatewayBootstrapTokenChunkProcessor(this.bootstrapTokens);

      proc.stdout?.on("data", (data: Buffer) => {
        const redacted = stdoutProcessor.processChunk(data.toString());
        if (!redacted) return;
        appendGatewayStartupLogLines(startupLogLines, redacted);
        this.emit("log", {
          level: "info",
          message: redacted.trimEnd(),
          timestamp: new Date().toISOString(),
        });
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const redacted = stderrProcessor.processChunk(data.toString());
        if (!redacted) return;
        appendGatewayStartupLogLines(startupLogLines, redacted);
        this.emit("log", {
          level: "error",
          message: redacted.trimEnd(),
          timestamp: new Date().toISOString(),
        });
      });

      proc.onExit((code) => {
        const stdoutFlush = stdoutProcessor.flushRemainder();
        if (stdoutFlush) {
          appendGatewayStartupLogLines(startupLogLines, stdoutFlush);
          this.emit("log", {
            level: "info",
            message: stdoutFlush.trimEnd(),
            timestamp: new Date().toISOString(),
          });
        }

        const stderrFlush = stderrProcessor.flushRemainder();
        if (stderrFlush) {
          appendGatewayStartupLogLines(startupLogLines, stderrFlush);
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
    } catch (error) {
      if (this.status === "starting") {
        this.setStatus("error");
      }
      throw error;
    } finally {
      this.startInFlight = false;
    }
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
          proc.forceTerminate();
        } catch {
          /* already dead */
        }
        if (this.status !== "stopped") this.setStatus("stopped");
        resolve();
      }, 5_000);
      killTimer.unref();

      proc.onceExit(() => {
        clearTimeout(killTimer);
        if (this.stoppingProcess === proc) this.stoppingProcess = null;
        this.setStatus("stopped");
        resolve();
      });

      try {
        proc.terminate();
      } catch {
        // Process already exited (ESRCH) — exit event will fire or already fired.
        // If it already fired before we attached our listener, resolve now.
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearTimeout(killTimer);
          if (this.stoppingProcess === proc) this.stoppingProcess = null;
          this.setStatus("stopped");
          resolve();
        }
      }
    });
  }

  private async waitForHealth(
    proc: DesktopSubprocess,
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
      proc.forceTerminate();
    } catch {
      /* process already exited */
    }
    this.process = null;
    this.setStatus("error");
    const startupReason = summarizeGatewayStartupFailure(startupLogLines);
    if (startupReason) throw new Error(`Gateway failed to start within timeout: ${startupReason}`);
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
          if (this.status === "error") this.setStatus("running");
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
    if (!this.healthTimer) return;
    clearInterval(this.healthTimer);
    this.healthTimer = null;
  }
}
