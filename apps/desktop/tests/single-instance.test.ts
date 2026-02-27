import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TYRUM_DESKTOP_APP_USER_MODEL_ID,
  clearLastSecondInstanceArgv,
  getLastSecondInstanceArgv,
  setWindowsAppUserModelId,
  setupSingleInstance,
} from "../src/main/single-instance.js";

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    writable: true,
  });

  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  }
}

describe("desktop main single-instance helpers", () => {
  beforeEach(() => {
    clearLastSecondInstanceArgv();
  });

  it("sets the Windows AppUserModelId to the electron-builder appId", () => {
    const setAppUserModelId = vi.fn();

    withPlatform("win32", () => {
      setWindowsAppUserModelId({ setAppUserModelId });
    });

    expect(setAppUserModelId).toHaveBeenCalledTimes(1);
    expect(setAppUserModelId).toHaveBeenCalledWith(TYRUM_DESKTOP_APP_USER_MODEL_ID);
  });

  it("does not set AppUserModelId on non-Windows platforms", () => {
    const setAppUserModelId = vi.fn();

    withPlatform("linux", () => {
      setWindowsAppUserModelId({ setAppUserModelId });
    });

    expect(setAppUserModelId).not.toHaveBeenCalled();
  });

  it("quits immediately when the single-instance lock is not acquired", () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      on: vi.fn(),
      quit: vi.fn(),
    };

    const didAcquireLock = setupSingleInstance({
      app,
      getMainWindow: () => null,
    });

    expect(didAcquireLock).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.on).not.toHaveBeenCalled();
    expect(getLastSecondInstanceArgv()).toBeNull();
  });

  it("focuses/restores the main window and captures argv on second-instance", () => {
    const onHandlers = new Map<string, (...args: any[]) => void>();
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        onHandlers.set(event, handler);
      }),
      quit: vi.fn(),
    };

    const onSecondInstance = vi.fn();
    const mainWindow = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    const didAcquireLock = setupSingleInstance({
      app,
      getMainWindow: () => mainWindow,
      onSecondInstance,
    });

    expect(didAcquireLock).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(onHandlers.has("second-instance")).toBe(true);

    const argv = ["electron", "tyrum://open?x=1"];
    const handler = onHandlers.get("second-instance");
    expect(handler).toBeTypeOf("function");

    handler?.({}, argv, "/tmp");

    expect(getLastSecondInstanceArgv()).toEqual(argv);
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).toHaveBeenCalledWith(argv, "/tmp");
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("still captures argv and invokes the callback when no main window exists", () => {
    const onHandlers = new Map<string, (...args: any[]) => void>();
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        onHandlers.set(event, handler);
      }),
      quit: vi.fn(),
    };

    const onSecondInstance = vi.fn();
    setupSingleInstance({
      app,
      getMainWindow: () => null,
      onSecondInstance,
    });

    const handler = onHandlers.get("second-instance");
    expect(handler).toBeTypeOf("function");

    const argv = ["electron", "tyrum://open?x=1"];
    handler?.({}, argv, "/tmp");

    expect(getLastSecondInstanceArgv()).toEqual(argv);
    expect(onSecondInstance).toHaveBeenCalledWith(argv, "/tmp");
  });
});
