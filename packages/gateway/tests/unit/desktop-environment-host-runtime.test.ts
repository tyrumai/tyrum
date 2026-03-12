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
});
