import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface GatewayManagerOptions {
  gatewayBin: string;
  port: number;
  dbPath: string;
  wsToken: string;
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

export class GatewayManager extends EventEmitter<GatewayManagerEvents> {
  private process: ChildProcess | null = null;
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

    this.process = spawn("node", [opts.gatewayBin], {
      env: {
        ...process.env,
        GATEWAY_PORT: String(opts.port),
        GATEWAY_HOST: host,
        GATEWAY_DB_PATH: opts.dbPath,
        GATEWAY_WS_TOKEN: opts.wsToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.emit("log", {
        level: "info",
        message: data.toString().trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.emit("log", {
        level: "error",
        message: data.toString().trimEnd(),
        timestamp: new Date().toISOString(),
      });
    });

    this.process.on("exit", (code) => {
      this.setStatus(code === 0 ? "stopped" : "error");
      this.emit("exit", code);
      this.process = null;
      this.stopHealthCheck();
    });

    await this.waitForHealth(opts.port, host);
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

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        resolve();
      }, 5_000);
      killTimer.unref();

      proc.once("exit", () => {
        clearTimeout(killTimer);
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
          this.setStatus("stopped");
          resolve();
        }
      }
    });
  }

  private async waitForHealth(
    port: number,
    host: string,
    maxAttempts = 30,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://${host}:${port}/healthz`);
        if (res.ok) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.process?.kill("SIGKILL");
    this.process = null;
    this.setStatus("error");
    throw new Error("Gateway failed to start within timeout");
  }

  private startHealthCheck(port: number, host: string): void {
    this.healthTimer = setInterval(async () => {
      try {
        const res = await fetch(`http://${host}:${port}/healthz`);
        if (!res.ok) {
          this.setStatus("error");
          this.emit("health-fail");
        }
      } catch {
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
