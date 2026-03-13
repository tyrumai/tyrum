import { afterEach, describe, expect, it, vi } from "vitest";

const { probeDockerAvailabilityMock } = vi.hoisted(() => ({
  probeDockerAvailabilityMock: vi.fn(),
}));

vi.mock("../../src/modules/desktop-environments/docker-cli.js", () => ({
  probeDockerAvailability: probeDockerAvailabilityMock,
}));

import { DesktopEnvironmentHostRuntime } from "../../src/modules/desktop-environments/host-runtime.js";

describe("DesktopEnvironmentHostRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("skips overlapping ticks while an async reconcile is still in flight", async () => {
    vi.useFakeTimers();
    probeDockerAvailabilityMock.mockResolvedValue({ ok: true });

    const hostDal = {
      upsert: vi.fn(async () => {}),
    };
    let reconcileCount = 0;
    let releaseSecondTick: (() => void) | null = null;
    const runtimeManager = {
      reconcileAll: vi.fn(async () => {
        reconcileCount += 1;
        if (reconcileCount !== 2) return;
        await new Promise<void>((resolve) => {
          releaseSecondTick = resolve;
        });
      }),
    };

    const runtime = new DesktopEnvironmentHostRuntime(hostDal as never, runtimeManager as never, {
      hostId: "host-1",
      label: "Primary runtime",
      intervalMs: 1_000,
    });

    await runtime.start();
    expect(runtimeManager.reconcileAll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtimeManager.reconcileAll).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtimeManager.reconcileAll).toHaveBeenCalledTimes(2);
    expect(hostDal.upsert).toHaveBeenCalledTimes(2);

    releaseSecondTick?.();
    await Promise.resolve();
    await runtime.stop();
  });

  it("logs and survives background tick failures from host persistence", async () => {
    vi.useFakeTimers();
    probeDockerAvailabilityMock.mockResolvedValue({ ok: true });

    const hostDal = {
      upsert: vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockResolvedValueOnce(),
    };
    const runtimeManager = {
      reconcileAll: vi.fn(async () => {}),
    };
    const logger = {
      error: vi.fn(),
    };

    const runtime = new DesktopEnvironmentHostRuntime(hostDal as never, runtimeManager as never, {
      hostId: "host-1",
      label: "Primary runtime",
      intervalMs: 1_000,
      logger: logger as never,
    });

    await runtime.start();
    expect(hostDal.upsert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith("desktop_environment.host_tick_failed", {
      host_id: "host-1",
      error: "db unavailable",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(hostDal.upsert).toHaveBeenCalledTimes(3);
    expect(runtimeManager.reconcileAll).toHaveBeenCalledTimes(2);

    await runtime.stop();
  });
});
