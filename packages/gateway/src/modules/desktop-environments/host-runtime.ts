import type { Logger } from "../observability/logger.js";
import { VERSION } from "../../version.js";
import { DesktopEnvironmentHostDal } from "./dal.js";
import {
  probeDockerAvailability,
  type DesktopEnvironmentRuntimeManager,
} from "./runtime-manager.js";

export class DesktopEnvironmentHostRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;

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
    await this.tick();
    const intervalMs = Math.max(1_000, this.options.intervalMs ?? 10_000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const docker = probeDockerAvailability();
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
