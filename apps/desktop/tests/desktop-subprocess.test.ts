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
});
