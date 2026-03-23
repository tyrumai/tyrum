import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayManager } from "../src/main/gateway-manager.js";
import { createMockDesktopSubprocess, type Internal } from "./gateway-manager.test-helpers.js";

describe("GatewayManager health checks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores status to running after transient health failure", async () => {
    const gm = new GatewayManager();
    const internal = gm as unknown as Internal;
    internal.process = {};
    internal.setStatus("running");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const onHealthFail = vi.fn();
    gm.on("health-fail", onHealthFail);

    internal.startHealthCheck(7777, "127.0.0.1");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(gm.status).toBe("error");
    expect(onHealthFail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(gm.status).toBe("running");
    expect(onHealthFail).toHaveBeenCalledTimes(1);

    internal.stopHealthCheck();
  });

  it("does not restore running when process is no longer managed", async () => {
    const gm = new GatewayManager();
    const internal = gm as unknown as Internal;
    internal.process = null;
    internal.setStatus("error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

    internal.startHealthCheck(7777, "127.0.0.1");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(gm.status).toBe("error");

    internal.stopHealthCheck();
  });

  it("ignores stale failed health checks after stop", async () => {
    const gm = new GatewayManager();
    const internal = gm as unknown as Internal;
    internal.process = {};
    internal.setStatus("running");

    let rejectHealth: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectHealth = reject;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onHealthFail = vi.fn();
    gm.on("health-fail", onHealthFail);

    internal.startHealthCheck(7777, "127.0.0.1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    internal.process = null;
    internal.stopHealthCheck();
    internal.setStatus("stopped");

    rejectHealth?.(new Error("health check aborted"));
    await Promise.resolve();
    await Promise.resolve();

    expect(gm.status).toBe("stopped");
    expect(onHealthFail).toHaveBeenCalledTimes(0);
  });
});

describe("GatewayManager stop() race-condition handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when process already exited", async () => {
    const gm = new GatewayManager();
    const { proc } = createMockDesktopSubprocess({ exitCode: 0 });
    (gm as unknown as Internal).process = proc;

    await gm.stop();

    expect(gm.status).toBe("stopped");
    expect(proc.terminate).not.toHaveBeenCalled();
  });

  it("handles terminate throwing ESRCH", async () => {
    const gm = new GatewayManager();
    const { proc, emitExit } = createMockDesktopSubprocess();
    proc.terminate = vi.fn(() => {
      const err = new Error("kill ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      emitExit(1);
      throw err;
    });
    (gm as unknown as Internal).process = proc;

    await gm.stop();

    expect(gm.status).toBe("stopped");
  });

  it("force-terminates when graceful terminate throws on windows-like platforms", async () => {
    const gm = new GatewayManager();
    const internal = gm as unknown as Internal;
    const { proc } = createMockDesktopSubprocess();

    proc.terminate = vi.fn(() => {
      const err = new Error("signal not supported") as NodeJS.ErrnoException;
      err.code = "EINVAL";
      throw err;
    });
    internal.process = proc;
    internal.setStatus("running");

    const stopPromise = gm.stop();

    expect(proc.terminate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await stopPromise;

    expect(proc.forceTerminate).toHaveBeenCalledTimes(1);
    expect(gm.status).toBe("stopped");
  });

  it("escalates to forceTerminate after timeout", async () => {
    const gm = new GatewayManager();
    const internal = gm as unknown as Internal;
    const { proc } = createMockDesktopSubprocess();
    proc.terminate = vi.fn(() => {});
    internal.process = proc;
    internal.setStatus("running");

    const stopPromise = gm.stop();

    expect(proc.terminate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(proc.forceTerminate).toHaveBeenCalledTimes(1);

    await stopPromise;
    expect(gm.status).toBe("stopped");
  });

  it("concurrent stop() calls are safe", async () => {
    const gm = new GatewayManager();
    const { proc, emitExit } = createMockDesktopSubprocess();
    proc.terminate = vi.fn(() => {});
    (gm as unknown as Internal).process = proc;

    const p1 = gm.stop();
    const p2 = gm.stop();

    emitExit(0);

    await Promise.all([p1, p2]);
    expect(gm.status).toBe("stopped");
  });

  it("stop() after spontaneous exit is a no-op", async () => {
    const gm = new GatewayManager();
    const { proc, emitExit } = createMockDesktopSubprocess();
    (gm as unknown as Internal).process = proc;

    emitExit(0);
    (gm as unknown as Internal).process = null;

    await gm.stop();

    expect(proc.terminate).not.toHaveBeenCalled();
    expect(gm.status).toBe("stopped");
  });
});
