import type { Logger } from "../observability/logger.js";
import { VERSION } from "../../version.js";
import { DesktopEnvironmentHostDal } from "./dal.js";
import type { DesktopEnvironmentRuntimeManager } from "./runtime-manager.js";
import { probeDockerAvailability } from "./docker-cli.js";

export class DesktopEnvironmentHostRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;

  constructor(
    private readonly hostDal: DesktopEnvironmentHostDal,
    private readonly runtimeManager: DesktopEnvironmentRuntimeManager,
    private readonly options: {
      hostId: string;
      label: string;
      intervalMs?: number;
      logger?: Logger;
    },
  ) {}

  async start(): Promise<void> {
    await this.runTick();
    const intervalMs = Math.max(1_000, this.options.intervalMs ?? 10_000);
    this.timer = setInterval(() => {
      void this.runTick();
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeTick;
  }

  private async runTick(): Promise<void> {
    if (this.activeTick) {
      await this.activeTick;
      return;
    }
    const tickPromise = this.tick().finally(() => {
      if (this.activeTick === tickPromise) {
        this.activeTick = null;
      }
    });
    this.activeTick = tickPromise;
    await tickPromise;
  }

  private async tick(): Promise<void> {
    const docker = await probeDockerAvailability();
    await this.hostDal.upsert({
      hostId: this.options.hostId,
      label: this.options.label,
      version: VERSION,
      dockerAvailable: docker.ok,
      healthy: docker.ok,
      lastSeenAt: new Date().toISOString(),
      lastError: docker.ok ? null : (docker.error ?? "docker unavailable"),
    });
    if (!docker.ok) return;

    try {
      await this.runtimeManager.reconcileAll();
    } catch (error) {
      this.options.logger?.error("desktop_environment.host_reconcile_failed", {
        host_id: this.options.hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
