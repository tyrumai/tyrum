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
  resolveGatewayLaunchCommand,
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

type StartOptions = Parameters<GatewayManager["start"]>[0];

const defaultStartOptions: StartOptions = {
  gatewayBin: "/nonexistent",
  port: 7788,
  dbPath: "/tmp/test.db",
  accessToken: "test-token",
};

function gatewayStartOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return { ...defaultStartOptions, ...overrides };
}

function stubHealthyFetch() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
}

function mockStreamingProc() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((signal?: string) => {
      if (signal === "SIGTERM") {
        proc.signalCode = "SIGTERM";
        queueMicrotask(() => proc.emit("exit", null));
      }
    }),
    stdout,
    stderr,
    stdin: null,
    pid: 12345,
  });
  return { proc, stdout, stderr };
}

async function startGatewayForLogs() {
  const gm = new GatewayManager();
  const { proc, stdout, stderr } = mockStreamingProc();
  spawnMock.mockReturnValue(proc as never);
  stubHealthyFetch();

  const logs: { level: string; message: string }[] = [];
  gm.on("log", (entry) => logs.push(entry));

  await gm.start(gatewayStartOptions());
  return { gm, proc, stdout, stderr, logs };
}

describe("GatewayManager", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("status starts as 'stopped'", () => {
    const gm = new GatewayManager();
    expect(gm.status).toBe("stopped");
  });

  it.each([
    {
      name: "summarizes startup logs with highest-priority bind errors",
      lines: [
        "Watcher processor and scheduler started",
        "Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
        "at Server.setupListenHandle (node:net:1940:16)",
      ],
      expected: "Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
    },
    {
      name: "falls back to the last non-empty startup line",
      lines: ["one", "two", "  ", "final line"],
      expected: "final line",
    },
    {
      name: "ignores stack footer noise and picks the actual error line",
      lines: [
        "node:internal/modules/cjs/loader:1386",
        "  throw err;",
        "  ^",
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'",
        "    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)",
        "    at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)",
        "Node.js v24.9.0",
      ],
      expected: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'",
    },
    {
      name: "prefers generic error lines over Node.js version footer",
      lines: [
        "node:internal/modules/run_main:123",
        "Error: spawn /tmp/bin ENOENT",
        "    at ChildProcess._handle.onexit (node:internal/child_process:286:19)",
        "Node.js v24.9.0",
      ],
      expected: "Error: spawn /tmp/bin ENOENT",
    },
  ])("$name", ({ lines, expected }) => {
    expect(summarizeGatewayStartupFailure(lines)).toBe(expected);
  });

  it("stop() on a stopped manager is a no-op", async () => {
    const gm = new GatewayManager();
    await gm.stop();
    expect(gm.status).toBe("stopped");
  });

  it("start() when already running throws", async () => {
    const gm = new GatewayManager();

    const internal = gm as unknown as Internal;
    internal.process = {};

    await expect(gm.start(gatewayStartOptions({ port: 9999 }))).rejects.toThrow(
      "Gateway already running",
    );
  });

  it("emits status-change events", () => {
    const gm = new GatewayManager();
    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

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
    stubHealthyFetch();

    await gm.start(gatewayStartOptions({ accessToken: "local-token-123" }));

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
    expect(env?.["ELECTRON_RUN_AS_NODE"]).toBeUndefined();

    await gm.stop();
  });

  it("issues a default tenant admin token via the embedded gateway bundle", async () => {
    const gm = new GatewayManager();
    const { proc, stdout } = mockStreamingProc();
    spawnMock.mockReturnValue(proc as never);

    queueMicrotask(() => {
      stdout.emit("data", Buffer.from("tokens.issue-default-tenant-admin: ok\n"));
      stdout.emit("data", Buffer.from("default-tenant-admin: tyrum-token.v1.issued.token\n"));
      proc.exitCode = 0;
      proc.emit("exit", 0, null);
    });

    const token = await gm.issueDefaultTenantAdminToken({
      gatewayBin: "/nonexistent",
      dbPath: "/tmp/test.db",
    });

    expect(token).toBe("tyrum-token.v1.issued.token");

    const [, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(args).toEqual([
      "/nonexistent",
      "tokens",
      "issue-default-tenant-admin",
      "--home",
      "/tmp",
      "--db",
      "/tmp/test.db",
    ]);
    const env = (options as { env?: Record<string, string> }).env;
    expect(env?.["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
  });

  it("redacts recovered tokens from token-issue failures", async () => {
    const gm = new GatewayManager();
    const { proc, stdout } = mockStreamingProc();
    spawnMock.mockReturnValue(proc as never);

    queueMicrotask(() => {
      stdout.emit("data", Buffer.from("default-tenant-admin: tyrum-token.v1.secret.token\n"));
      proc.exitCode = 1;
      proc.emit("exit", 1, null);
    });

    const issue = gm.issueDefaultTenantAdminToken({
      gatewayBin: "/nonexistent",
      dbPath: "/tmp/test.db",
    });

    await expect(issue).rejects.toThrow("default-tenant-admin: [REDACTED]");
    await issue.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("tyrum-token.v1.secret.token");
    });
  });

  it.each([
    {
      name: "uses Electron-as-Node for staged gateway bundles inside Electron",
      gatewayBin: "/repo/apps/desktop/dist/gateway/index.mjs",
      gatewayBinSource: "staged" as const,
      expected: {
        command: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
    {
      name: "uses a real Node runtime for the monorepo gateway bundle inside Electron",
      gatewayBin: "/repo/packages/gateway/dist/index.mjs",
      gatewayBinSource: "monorepo" as const,
      expected: {
        command: "/opt/homebrew/bin/node",
        env: {},
      },
    },
    {
      name: "uses Electron-as-Node for packaged gateway bundles",
      gatewayBin: "/Applications/Tyrum.app/Contents/Resources/gateway/index.mjs",
      gatewayBinSource: "packaged" as const,
      expected: {
        command: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  ])("$name", ({ gatewayBin, gatewayBinSource, expected }) => {
    expect(
      resolveGatewayLaunchCommand({
        gatewayBin,
        gatewayBinSource,
        processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        versions: { ...process.versions, electron: "40.7.0" },
        env: { TYRUM_DESKTOP_NODE_EXEC_PATH: "/opt/homebrew/bin/node" },
      }),
    ).toEqual(expected);
  });

  it.each([
    {
      name: "preserves CRLF line endings when redacting bootstrap tokens",
      chunks: ["system: tyrum-token.v1.abc.def\r\nhello\r\n"],
      expectedLog: "system: [REDACTED]\r\nhello",
    },
    {
      name: "preserves original indentation and padding when redacting bootstrap tokens",
      chunks: ["\t  system: tyrum-token.v1.abc.def   \r\nhello\r\n"],
      expectedLog: "\t  system: [REDACTED]   \r\nhello",
    },
    {
      name: "captures bootstrap tokens when log prefixes precede the label",
      chunks: ["[gateway] default-tenant-admin: tyrum-token.v1.abc.def\r\n"],
      expectedLog: "[gateway] default-tenant-admin: [REDACTED]",
      expectedToken: ["default-tenant-admin", "tyrum-token.v1.abc.def"] as const,
    },
    {
      name: "captures bootstrap tokens split across stdout chunks without leaking them",
      chunks: ["system: tyrum-token.v1.abc.", "def\r\nhello\r\n"],
      expectedLog: "system: [REDACTED]\r\nhello",
      expectedToken: ["system", "tyrum-token.v1.abc.def"] as const,
      assertBeforeLastChunk: true,
    },
  ])("$name", async ({ chunks, expectedLog, expectedToken, assertBeforeLastChunk }) => {
    const { gm, stdout, logs } = await startGatewayForLogs();
    for (const [index, chunk] of chunks.entries()) {
      stdout.emit("data", Buffer.from(chunk));
      if (assertBeforeLastChunk && index === 0) {
        expect(logs.some((entry) => entry.message.includes("tyrum-token.v1."))).toBe(false);
        expect(gm.getBootstrapToken("system")).toBeUndefined();
      }
    }

    if (expectedToken) {
      expect(gm.getBootstrapToken(expectedToken[0])).toBe(expectedToken[1]);
    }
    expect(logs.some((entry) => entry.message.includes("tyrum-token.v1."))).toBe(false);
    expect(logs.at(-1)?.message).toBe(expectedLog);

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
    stubHealthyFetch();

    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    await gm.start(gatewayStartOptions({ port: 7777 }));
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

    await expect(gm.start(gatewayStartOptions())).rejects.toThrow("Gateway failed to start");

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
