import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { appIsReadyMock, spawnMock, utilityForkMock } = vi.hoisted(() => ({
  appIsReadyMock: vi.fn(() => true),
  spawnMock: vi.fn(),
  utilityForkMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    isReady: appIsReadyMock,
  },
  utilityProcess: {
    fork: utilityForkMock,
  },
}));

import { launchDesktopSubprocess } from "../src/main/desktop-subprocess.js";

function createNodeChild() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    stdout: null,
    stderr: null,
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
}

function createUtilityChild() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    stdout: null,
    stderr: null,
    pid: 5678,
    kill: vi.fn(() => true),
  });
}

function createReadableStreamEmitter() {
  const stream = new EventEmitter();
  return Object.assign(stream, {
    readableEnded: false,
    closed: false,
    destroyed: false,
  });
}

describe("launchDesktopSubprocess", () => {
  afterEach(() => {
    spawnMock.mockReset();
    utilityForkMock.mockReset();
    appIsReadyMock.mockReset();
    appIsReadyMock.mockReturnValue(true);
    delete process.env["TYRUM_DESKTOP_SUBPROCESS_BASE"];
    delete process.env["TYRUM_DESKTOP_SUBPROCESS_OVERRIDE"];
  });

  it("inherits the parent environment for node launches", async () => {
    process.env["TYRUM_DESKTOP_SUBPROCESS_BASE"] = "base";
    process.env["TYRUM_DESKTOP_SUBPROCESS_OVERRIDE"] = "parent";
    spawnMock.mockReturnValue(createNodeChild());

    await launchDesktopSubprocess({
      kind: "node",
      command: "node",
      args: ["./worker.mjs"],
      env: {
        TYRUM_DESKTOP_SUBPROCESS_OVERRIDE: "child",
      },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["./worker.mjs"],
      expect.objectContaining({
        env: expect.objectContaining({
          TYRUM_DESKTOP_SUBPROCESS_BASE: "base",
          TYRUM_DESKTOP_SUBPROCESS_OVERRIDE: "child",
        }),
      }),
    );
  });

  it("inherits the parent environment for utility launches", async () => {
    process.env["TYRUM_DESKTOP_SUBPROCESS_BASE"] = "base";
    process.env["TYRUM_DESKTOP_SUBPROCESS_OVERRIDE"] = "parent";
    utilityForkMock.mockReturnValue(createUtilityChild());

    await launchDesktopSubprocess({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: ["payload"],
      env: {
        TYRUM_DESKTOP_SUBPROCESS_OVERRIDE: "child",
      },
      serviceName: "Test Helper",
    });

    expect(utilityForkMock).toHaveBeenCalledWith(
      "/tmp/helper.mjs",
      ["payload"],
      expect.objectContaining({
        env: expect.objectContaining({
          TYRUM_DESKTOP_SUBPROCESS_BASE: "base",
          TYRUM_DESKTOP_SUBPROCESS_OVERRIDE: "child",
        }),
      }),
    );
  });

  it("proxies node subprocess lifecycle events and terminate helpers", async () => {
    const child = createNodeChild();
    spawnMock.mockReturnValue(child);
    const proc = await launchDesktopSubprocess({
      kind: "node",
      command: "node",
      args: ["./worker.mjs"],
      env: {},
    });

    const onExit = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    proc.onExit(onExit);
    proc.onceComplete(onComplete);
    proc.onceError(onError);

    child.emit("exit", 0, "SIGTERM");
    child.emit("close", 0, "SIGTERM");
    const error = new Error("launch failed");
    child.emit("error", error);

    expect(onExit).toHaveBeenCalledWith(0, "SIGTERM");
    expect(onComplete).toHaveBeenCalledWith(0, "SIGTERM");
    expect(onError).toHaveBeenCalledWith(error);

    child.kill.mockImplementation(() => {
      const killError = new Error("missing") as NodeJS.ErrnoException;
      killError.code = "ESRCH";
      throw killError;
    });

    expect(() => proc.terminate()).not.toThrow();

    child.pid = undefined;
    expect(() => proc.forceTerminate()).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("proxies utility subprocess lifecycle events and force-terminates when needed", async () => {
    const child = createUtilityChild();
    utilityForkMock.mockReturnValue(child);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const proc = await launchDesktopSubprocess({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: ["payload"],
      env: {},
      serviceName: "Test Helper",
    });

    const onExit = vi.fn();
    const onComplete = vi.fn();

    proc.onExit(onExit);
    proc.onceComplete(onComplete);

    child.emit("exit", 0);

    expect(proc.exitCode).toBe(0);
    expect(proc.signalCode).toBeNull();
    expect(onExit).toHaveBeenCalledWith(0, null);
    expect(onComplete).toHaveBeenCalledWith(0, null);

    child.kill.mockReturnValue(false);
    proc.terminate();
    proc.forceTerminate();

    expect(killSpy).toHaveBeenCalledWith(5678, "SIGKILL");
  });

  it("waits for utility stdio to drain before firing onceComplete", async () => {
    const child = createUtilityChild();
    const stdout = createReadableStreamEmitter();
    const stderr = createReadableStreamEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    utilityForkMock.mockReturnValue(child);

    const proc = await launchDesktopSubprocess({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: ["payload"],
      env: {},
      serviceName: "Test Helper",
    });

    const onComplete = vi.fn();
    proc.onceComplete(onComplete);

    child.emit("exit", 0);
    expect(onComplete).not.toHaveBeenCalled();

    stdout.readableEnded = true;
    stdout.closed = true;
    stdout.emit("close");
    expect(onComplete).not.toHaveBeenCalled();

    stderr.readableEnded = true;
    stderr.closed = true;
    stderr.emit("close");
    expect(onComplete).toHaveBeenCalledWith(0, null);
  });

  it("falls back after utility exit if stdio never reports completion", async () => {
    vi.useFakeTimers();
    try {
      const child = createUtilityChild();
      child.stdout = createReadableStreamEmitter();
      child.stderr = createReadableStreamEmitter();
      utilityForkMock.mockReturnValue(child);

      const proc = await launchDesktopSubprocess({
        kind: "utility",
        modulePath: "/tmp/helper.mjs",
        args: ["payload"],
        env: {},
        serviceName: "Test Helper",
      });

      const onComplete = vi.fn();
      proc.onceComplete(onComplete);

      child.emit("exit", 0);
      expect(onComplete).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(onComplete).toHaveBeenCalledWith(0, null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects utility launches before Electron app readiness", async () => {
    appIsReadyMock.mockReturnValue(false);

    await expect(
      launchDesktopSubprocess({
        kind: "utility",
        modulePath: "/tmp/helper.mjs",
        args: [],
        env: {},
        serviceName: "Test Helper",
      }),
    ).rejects.toThrow("Electron utilityProcess can only be launched after the app is ready.");
  });
});
