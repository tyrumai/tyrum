import { EventEmitter } from "node:events";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { launchDesktopSubprocessMock } = vi.hoisted(() => ({
  launchDesktopSubprocessMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  clipboard: {
    writeText: clipboardWriteTextMock,
  },
}));

vi.mock("../src/main/desktop-subprocess.js", async () => {
  const actual = await vi.importActual<typeof import("../src/main/desktop-subprocess.js")>(
    "../src/main/desktop-subprocess.js",
  );
  return {
    ...actual,
    launchDesktopSubprocess: launchDesktopSubprocessMock,
  };
});

import {
  IsolatedDesktopBackend,
  resolveDesktopScreenshotHelperLaunchSpec,
  resolveDesktopScreenshotHelperPath,
} from "../src/main/providers/backends/isolated-desktop-backend.js";
import type { DesktopSubprocess } from "../src/main/desktop-subprocess.js";

const allowMacScreenRecording = () => ({
  accessibility: true,
  screenRecording: true,
});

const { clipboardWriteTextMock } = vi.hoisted(() => ({
  clipboardWriteTextMock: vi.fn(),
}));

function createDelegate() {
  return {
    captureScreen: vi.fn(),
    moveMouse: vi.fn(),
    clickMouse: vi.fn(),
    doubleClickMouse: vi.fn(),
    dragMouse: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    writeClipboardText: vi.fn(),
  };
}

function createChildProcess(kind: DesktopSubprocess["kind"] = "utility") {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  return {
    proc: {
      kind,
      get stdout() {
        return stdout;
      },
      get stderr() {
        return stderr;
      },
      get pid() {
        return 12345;
      },
      get exitCode() {
        return exitCode;
      },
      get signalCode() {
        return signalCode;
      },
      onExit: (listener) => emitter.on("exit", listener),
      onceExit: (listener) => emitter.once("exit", listener),
      onceComplete: (listener) => emitter.once("complete", listener),
      onceError: (listener) => emitter.once("error", listener),
      terminate: vi.fn(),
      forceTerminate: vi.fn(),
    } satisfies DesktopSubprocess,
    stdout,
    stderr,
    emitComplete: (code: number | null, signal: NodeJS.Signals | null = null) => {
      exitCode = code;
      signalCode = signal;
      emitter.emit("exit", code, signal);
      emitter.emit("complete", code, signal);
    },
    emitError: (error: Error) => {
      emitter.emit("error", error);
    },
  };
}

describe("resolveDesktopScreenshotHelperPath", () => {
  it("uses the helper adjacent to the built main bundle when available", () => {
    const moduleDir = join("/repo", "apps", "desktop", "dist", "main");
    const expected = join(moduleDir, "desktop-screenshot-helper.mjs");

    expect(
      resolveDesktopScreenshotHelperPath({
        moduleDir,
        isPackaged: false,
        exists: (path) => path === expected,
      }),
    ).toBe(expected);
  });

  it("falls back to the packaged helper path", () => {
    const expected = join(
      "/Applications/Tyrum.app/Contents/Resources",
      "app.asar",
      "dist",
      "main",
      "desktop-screenshot-helper.mjs",
    );

    expect(
      resolveDesktopScreenshotHelperPath({
        moduleDir: "/missing",
        isPackaged: true,
        resourcesPath: "/Applications/Tyrum.app/Contents/Resources",
        exists: (path) => path === expected,
      }),
    ).toBe(expected);
  });
});

describe("resolveDesktopScreenshotHelperLaunchSpec", () => {
  it("uses utilityProcess when running inside Electron", () => {
    expect(
      resolveDesktopScreenshotHelperLaunchSpec({
        helperPath: "/tmp/helper.mjs",
        processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        versions: { ...process.versions, electron: "40.8.0" },
      }),
    ).toEqual({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: [],
      env: {},
      serviceName: "Tyrum Screenshot Helper",
      allowLoadingUnsignedLibraries: true,
    });
  });

  it("falls back to node when Electron is unavailable", () => {
    expect(
      resolveDesktopScreenshotHelperLaunchSpec({
        helperPath: "/tmp/helper.mjs",
        processExecPath: "/usr/local/bin/node",
        versions: process.versions,
      }),
    ).toEqual({
      kind: "node",
      command: "/usr/local/bin/node",
      args: ["/tmp/helper.mjs"],
      env: {},
    });
  });
});

describe("IsolatedDesktopBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clipboardWriteTextMock.mockReset();
    launchDesktopSubprocessMock.mockReset();
  });

  it("returns screenshot bytes from the helper response", async () => {
    const delegate = createDelegate();
    const child = createChildProcess();
    launchDesktopSubprocessMock.mockResolvedValue(child.proc);
    const backend = new IsolatedDesktopBackend(delegate, {
      helperPath: "/tmp/helper.mjs",
      macPermissions: allowMacScreenRecording,
      processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
      versions: { ...process.versions, electron: "40.8.0" },
    });

    const capturePromise = backend.captureScreen("primary");
    await Promise.resolve();
    child.stdout.emit(
      "data",
      `${JSON.stringify({
        ok: true,
        width: 640,
        height: 480,
        bytesBase64: Buffer.from("png-bytes", "utf8").toString("base64"),
      })}\n`,
    );
    child.emitComplete(0);

    await expect(capturePromise).resolves.toMatchObject({
      width: 640,
      height: 480,
      buffer: Buffer.from("png-bytes", "utf8"),
    });
    expect(launchDesktopSubprocessMock).toHaveBeenCalledWith({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: [JSON.stringify({ display: "primary" })],
      env: expect.any(Object),
      serviceName: "Tyrum Screenshot Helper",
      allowLoadingUnsignedLibraries: true,
    });
  });

  it("surfaces a helper-declared error as a capture failure", async () => {
    const child = createChildProcess();
    launchDesktopSubprocessMock.mockResolvedValue(child.proc);
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    await Promise.resolve();
    child.stdout.emit(
      "data",
      `${JSON.stringify({ ok: false, error: "Screen Recording permission denied" })}\n`,
    );
    child.emitComplete(0);

    await expect(capturePromise).rejects.toThrow("Screen Recording permission denied");
  });

  it("passes only explicit env overrides to the helper launch spec", async () => {
    const child = createChildProcess();
    launchDesktopSubprocessMock.mockResolvedValue(child.proc);
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      env: {
        TYRUM_TEST_OVERRIDE: "1",
        PATH: "/custom/bin",
      },
      macPermissions: allowMacScreenRecording,
      processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
      versions: { ...process.versions, electron: "40.8.0" },
    });

    const capturePromise = backend.captureScreen("primary");
    await Promise.resolve();

    expect(launchDesktopSubprocessMock).toHaveBeenCalledWith({
      kind: "utility",
      modulePath: "/tmp/helper.mjs",
      args: [JSON.stringify({ display: "primary" })],
      env: {
        TYRUM_TEST_OVERRIDE: "1",
        PATH: "/custom/bin",
      },
      serviceName: "Tyrum Screenshot Helper",
      allowLoadingUnsignedLibraries: true,
    });

    child.emitComplete(0);
    await expect(capturePromise).rejects.toThrow("Screen capture helper returned no result");
  });

  it("treats helper crashes as recoverable screenshot failures", async () => {
    const child = createChildProcess();
    launchDesktopSubprocessMock.mockResolvedValue(child.proc);
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    await Promise.resolve();
    child.stderr.emit("data", "Could not open main display");
    child.emitComplete(null, "SIGABRT");

    await expect(capturePromise).rejects.toThrow(
      "Screen capture helper exited with signal SIGABRT: Could not open main display",
    );
  });

  it("treats malformed helper output as an error instead of hanging", async () => {
    const child = createChildProcess();
    launchDesktopSubprocessMock.mockResolvedValue(child.proc);
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    await Promise.resolve();
    child.stdout.emit("data", "not-json");
    child.emitComplete(0);

    await expect(capturePromise).rejects.toThrow(
      "Screen capture helper returned invalid output: not-json",
    );
  });

  it("blocks macOS capture before spawn when Screen Recording is unavailable", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });

    try {
      const backend = new IsolatedDesktopBackend(createDelegate(), {
        helperPath: "/tmp/helper.mjs",
        macPermissions: () => ({
          accessibility: true,
          screenRecording: false,
        }),
      });

      await expect(backend.captureScreen("primary")).rejects.toThrow(
        "Desktop screenshot unavailable: macOS Screen Recording permission is required.",
      );
      expect(launchDesktopSubprocessMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true,
      });
    }
  });

  it("writes clipboard text through Electron without delegating to nut.js", async () => {
    const delegate = createDelegate();
    const backend = new IsolatedDesktopBackend(delegate, {
      macPermissions: allowMacScreenRecording,
    });

    await backend.writeClipboardText("copied from Electron");

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("copied from Electron");
    expect(delegate.writeClipboardText).not.toHaveBeenCalled();
  });

  it("redacts clipboard payloads when Electron clipboard writes fail", async () => {
    clipboardWriteTextMock.mockImplementation(() => {
      throw new Error("failed to copy super-secret-clipboard-text");
    });
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      macPermissions: allowMacScreenRecording,
    });

    await expect(backend.writeClipboardText("super-secret-clipboard-text")).rejects.toThrow(
      "Clipboard write failed",
    );
  });
});
