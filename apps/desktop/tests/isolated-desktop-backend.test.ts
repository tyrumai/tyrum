import { EventEmitter } from "node:events";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  clipboard: {
    writeText: clipboardWriteTextMock,
  },
}));

import {
  IsolatedDesktopBackend,
  resolveDesktopScreenshotHelperLaunchCommand,
  resolveDesktopScreenshotHelperPath,
} from "../src/main/providers/backends/isolated-desktop-backend.js";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

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

function createChildProcess(): MockChildProcess {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
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

describe("resolveDesktopScreenshotHelperLaunchCommand", () => {
  it("uses Electron-as-Node when running inside Electron", () => {
    expect(
      resolveDesktopScreenshotHelperLaunchCommand({
        processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        versions: { ...process.versions, electron: "40.8.0" },
      }),
    ).toEqual({
      command: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });
});

describe("IsolatedDesktopBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clipboardWriteTextMock.mockReset();
  });

  it("returns screenshot bytes from the helper response", async () => {
    const delegate = createDelegate();
    const child = createChildProcess();
    const spawnMock = vi.fn(() => child);
    const backend = new IsolatedDesktopBackend(delegate, {
      helperPath: "/tmp/helper.mjs",
      spawn: spawnMock as unknown as typeof import("node:child_process").spawn,
      macPermissions: allowMacScreenRecording,
      processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
      versions: { ...process.versions, electron: "40.8.0" },
    });

    const capturePromise = backend.captureScreen("primary");
    child.stdout.emit(
      "data",
      `${JSON.stringify({
        ok: true,
        width: 640,
        height: 480,
        bytesBase64: Buffer.from("png-bytes", "utf8").toString("base64"),
      })}\n`,
    );
    child.emit("close", 0, null);

    await expect(capturePromise).resolves.toMatchObject({
      width: 640,
      height: 480,
      buffer: Buffer.from("png-bytes", "utf8"),
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
      ["/tmp/helper.mjs", JSON.stringify({ display: "primary" })],
      expect.objectContaining({
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
      }),
    );
  });

  it("surfaces a helper-declared error as a capture failure", async () => {
    const child = createChildProcess();
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    child.stdout.emit(
      "data",
      `${JSON.stringify({ ok: false, error: "Screen Recording permission denied" })}\n`,
    );
    child.emit("close", 0, null);

    await expect(capturePromise).rejects.toThrow("Screen Recording permission denied");
  });

  it("treats helper crashes as recoverable screenshot failures", async () => {
    const child = createChildProcess();
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    child.stderr.emit("data", "Could not open main display");
    child.emit("close", null, "SIGABRT");

    await expect(capturePromise).rejects.toThrow(
      "Screen capture helper exited with signal SIGABRT: Could not open main display",
    );
  });

  it("treats malformed helper output as an error instead of hanging", async () => {
    const child = createChildProcess();
    const backend = new IsolatedDesktopBackend(createDelegate(), {
      helperPath: "/tmp/helper.mjs",
      spawn: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      macPermissions: allowMacScreenRecording,
    });

    const capturePromise = backend.captureScreen("primary");
    child.stdout.emit("data", "not-json");
    child.emit("close", 0, null);

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
      const spawnMock = vi.fn();
      const backend = new IsolatedDesktopBackend(createDelegate(), {
        helperPath: "/tmp/helper.mjs",
        spawn: spawnMock as unknown as typeof import("node:child_process").spawn,
        macPermissions: () => ({
          accessibility: true,
          screenRecording: false,
        }),
      });

      await expect(backend.captureScreen("primary")).rejects.toThrow(
        "Desktop screenshot unavailable: macOS Screen Recording permission is required.",
      );
      expect(spawnMock).not.toHaveBeenCalled();
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
