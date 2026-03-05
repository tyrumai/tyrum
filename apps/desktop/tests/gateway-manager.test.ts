import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import {
  GatewayManager,
  type GatewayStatus,
  summarizeGatewayStartupFailure,
} from "../src/main/gateway-manager.js";

/** Minimal mock that satisfies the ChildProcess surface used by GatewayManager. */
function mockProc(overrides: { exitCode?: number | null; signalCode?: string | null } = {}) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    exitCode: overrides.exitCode ?? null,
    signalCode: overrides.signalCode ?? null,
    kill: vi.fn(),
    stdout: null,
    stderr: null,
    stdin: null,
    pid: 12345,
  });
}

type Internal = {
  process: unknown;
  setStatus(s: GatewayStatus): void;
  startHealthCheck(port: number, host: string): void;
  stopHealthCheck(): void;
};

describe("GatewayManager", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("status starts as 'stopped'", () => {
    const gm = new GatewayManager();
    expect(gm.status).toBe("stopped");
  });

  it("summarizes startup logs with highest-priority bind errors", () => {
    const reason = summarizeGatewayStartupFailure([
      "Watcher processor and scheduler started",
      "Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
      "at Server.setupListenHandle (node:net:1940:16)",
    ]);
    expect(reason).toBe("Error: listen EADDRINUSE: address already in use 127.0.0.1:8788");
  });

  it("falls back to the last non-empty startup line", () => {
    const reason = summarizeGatewayStartupFailure(["one", "two", "  ", "final line"]);
    expect(reason).toBe("final line");
  });

  it("ignores stack footer noise and picks the actual error line", () => {
    const reason = summarizeGatewayStartupFailure([
      "node:internal/modules/cjs/loader:1386",
      "  throw err;",
      "  ^",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'",
      "    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)",
      "    at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)",
      "Node.js v24.9.0",
    ]);
    expect(reason).toBe("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'");
  });

  it("prefers generic error lines over Node.js version footer", () => {
    const reason = summarizeGatewayStartupFailure([
      "node:internal/modules/run_main:123",
      "Error: spawn /tmp/bin ENOENT",
      "    at ChildProcess._handle.onexit (node:internal/child_process:286:19)",
      "Node.js v24.9.0",
    ]);
    expect(reason).toBe("Error: spawn /tmp/bin ENOENT");
  });

  it("stop() on a stopped manager is a no-op", async () => {
    const gm = new GatewayManager();
    await gm.stop();
    expect(gm.status).toBe("stopped");
  });

  it("start() when already running throws", async () => {
    const gm = new GatewayManager();

    // Simulate an already-running state by setting the private process field
    // to a truthy value via type assertion. This avoids spawning a real process.
    const internal = gm as unknown as Internal;
    internal.process = {};

    await expect(
      gm.start({
        gatewayBin: "/nonexistent",
        port: 9999,
        dbPath: "/tmp/test.db",
        accessToken: "test-token",
      }),
    ).rejects.toThrow("Gateway already running");
  });

  it("emits status-change events", () => {
    const gm = new GatewayManager();
    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    // Trigger internal setStatus via stop() which won't emit because
    // process is null. We can verify the event mechanism works by
    // calling setStatus directly.
    const internal = gm as unknown as Internal;
    internal.setStatus("starting");
    internal.setStatus("running");
    internal.setStatus("stopped");

    expect(statuses).toEqual(["starting", "running", "stopped"]);
  });

  it("passes CLI flags when starting gateway", async () => {
    const gm = new GatewayManager();
    const proc = mockProc();
    proc.kill.mockImplementation((signal?: string) => {
      if (signal === "SIGTERM") {
        proc.signalCode = "SIGTERM";
        queueMicrotask(() => proc.emit("exit", null));
      }
    });
    spawnMock.mockReturnValue(proc);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

    await gm.start({
      gatewayBin: "/nonexistent",
      port: 7788,
      dbPath: "/tmp/test.db",
      accessToken: "local-token-123",
    });

    const [, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(args).toEqual([
      "/nonexistent",
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      "7788",
      "--home",
      "/tmp",
      "--db",
      "/tmp/test.db",
    ]);
    const env = (options as { env?: Record<string, string> }).env;
    expect(env?.["ELECTRON_RUN_AS_NODE"]).toBe("1");

    await gm.stop();
  });

  it("graceful stop does not emit transient error status", async () => {
    const gm = new GatewayManager();
    const proc = mockProc();
    proc.kill.mockImplementation((signal?: string) => {
      if (signal === "SIGTERM") {
        proc.signalCode = "SIGTERM";
        queueMicrotask(() => proc.emit("exit", null));
      }
    });
    spawnMock.mockReturnValue(proc);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    await gm.start({
      gatewayBin: "/nonexistent",
      port: 7777,
      dbPath: "/tmp/test.db",
      accessToken: "test-token",
    });
    await gm.stop();

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(statuses).toContain("stopped");
    expect(statuses).not.toContain("error");
  });

  it("does not report running when process exits after health passes", async () => {
    const gm = new GatewayManager();
    const proc = mockProc();
    spawnMock.mockReturnValue(proc);

    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (status) => statuses.push(status));

    const fetchMock = vi.fn().mockImplementation(async () => {
      queueMicrotask(() => {
        proc.exitCode = 1;
        proc.emit("exit", 1);
      });
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gm.start({
        gatewayBin: "/nonexistent",
        port: 7788,
        dbPath: "/tmp/test.db",
        accessToken: "test-token",
      }),
    ).rejects.toThrow("Gateway failed to start");

    expect(gm.status).toBe("error");
    expect(statuses).not.toContain("running");
  });

  describe("health checks", () => {
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

      // Simulate stop() finishing while the previous health-check request is in flight.
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

  describe("stop() race-condition handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves immediately when process already exited", async () => {
      const gm = new GatewayManager();
      const proc = mockProc({ exitCode: 0 });
      (gm as unknown as Internal).process = proc;

      await gm.stop();

      expect(gm.status).toBe("stopped");
      // kill should never have been called — process was already dead
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it("handles kill throwing ESRCH", async () => {
      const gm = new GatewayManager();
      const proc = mockProc();
      proc.kill.mockImplementation(() => {
        const err = new Error("kill ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        // Simulate the OS reporting it exited
        proc.exitCode = 1;
        throw err;
      });
      (gm as unknown as Internal).process = proc;

      // stop() should still resolve (catch path detects exitCode is set)
      await gm.stop();

      expect(gm.status).toBe("stopped");
    });

    it("resolves stop when signals are unsupported (windows-like)", async () => {
      const gm = new GatewayManager();
      const internal = gm as unknown as Internal;
      const proc = mockProc();

      proc.kill.mockImplementation(() => {
        const err = new Error("signal not supported") as NodeJS.ErrnoException;
        err.code = "EINVAL";
        throw err;
      });
      internal.process = proc;
      internal.setStatus("running");

      const stopPromise = gm.stop();

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(5_000);
      await stopPromise;

      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(gm.status).toBe("stopped");
    });

    it("escalates to SIGKILL after timeout", async () => {
      const gm = new GatewayManager();
      const internal = gm as unknown as Internal;
      const proc = mockProc();
      // SIGTERM succeeds but process doesn't exit
      proc.kill.mockImplementation(() => {});
      internal.process = proc;
      internal.setStatus("running");

      const stopPromise = gm.stop();

      // SIGTERM was sent
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

      // Advance past the 5 s escalation window
      await vi.advanceTimersByTimeAsync(5_000);

      // SIGKILL should have been sent
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");

      await stopPromise;
      expect(gm.status).toBe("stopped");
    });

    it("concurrent stop() calls are safe", async () => {
      const gm = new GatewayManager();
      const proc = mockProc();
      proc.kill.mockImplementation(() => {});
      (gm as unknown as Internal).process = proc;

      const p1 = gm.stop();
      const p2 = gm.stop(); // process already nulled — should be a no-op

      // Simulate exit for the first stop()
      proc.emit("exit", 0);

      await Promise.all([p1, p2]);
      expect(gm.status).toBe("stopped");
    });

    it("stop() after spontaneous exit is a no-op", async () => {
      const gm = new GatewayManager();
      const proc = mockProc();
      (gm as unknown as Internal).process = proc;

      // Simulate spontaneous exit: the start() exit handler would set
      // this.process = null and set status. We replicate that here.
      proc.exitCode = 0;
      (gm as unknown as Internal).process = null;

      await gm.stop();

      // Should have returned immediately (no process reference)
      expect(proc.kill).not.toHaveBeenCalled();
      expect(gm.status).toBe("stopped");
    });
  });
});
