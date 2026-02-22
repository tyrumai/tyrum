import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ipcMainHandleMock,
  registeredHandlers,
  showOpenDialogMock,
  openPathMock,
  appGetVersionMock,
  autoUpdaterMock,
  checkForUpdatesMock,
  downloadUpdateMock,
  quitAndInstallMock,
  listeners,
} = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn();
  const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const showOpenDialogMock = vi.fn();
  const openPathMock = vi.fn();
  const appGetVersionMock = vi.fn(() => "1.0.0");
  const checkForUpdatesMock = vi.fn(async () => undefined);
  const downloadUpdateMock = vi.fn(async () => undefined);
  const quitAndInstallMock = vi.fn();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const autoUpdaterMock = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: checkForUpdatesMock,
    downloadUpdate: downloadUpdateMock,
    quitAndInstall: quitAndInstallMock,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(listener);
      listeners.set(event, handlers);
      return autoUpdaterMock;
    }),
    emit: (event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event) ?? [];
      for (const handler of handlers) {
        handler(...args);
      }
    },
  };

  return {
    ipcMainHandleMock,
    registeredHandlers,
    showOpenDialogMock,
    openPathMock,
    appGetVersionMock,
    autoUpdaterMock,
    checkForUpdatesMock,
    downloadUpdateMock,
    quitAndInstallMock,
    listeners,
  };
});

vi.mock("electron", () => ({
  app: {
    getVersion: appGetVersionMock,
    isPackaged: true,
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
  shell: {
    openPath: openPathMock,
  },
}));

vi.mock("electron-updater", () => ({
  default: { autoUpdater: autoUpdaterMock },
  autoUpdater: autoUpdaterMock,
}));

describe("registerUpdateIpc handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    showOpenDialogMock.mockReset();
    openPathMock.mockReset();
    openPathMock.mockResolvedValue("");
    checkForUpdatesMock.mockReset();
    downloadUpdateMock.mockReset();
    quitAndInstallMock.mockReset();
    listeners.clear();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
  });

  it("registers update handlers and returns initial state", async () => {
    const { registerUpdateIpc } = await import("../src/main/ipc/update-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never;

    registerUpdateIpc(windowStub);

    const stateHandler = registeredHandlers.get("updates:state");
    expect(stateHandler).toBeDefined();

    const state = stateHandler!({} as never) as {
      stage: string;
      currentVersion: string;
    };
    expect(state.stage).toBe("checking");
    expect(state.currentVersion).toBe("1.0.0");
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("opens a selected installer file", async () => {
    const { registerUpdateIpc } = await import("../src/main/ipc/update-ipc.js");

    const selectedPath =
      process.platform === "darwin"
        ? "/tmp/Tyrum.dmg"
        : process.platform === "win32"
          ? "C:/temp/Tyrum.exe"
          : "/tmp/Tyrum.AppImage";

    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: [selectedPath],
    });
    openPathMock.mockResolvedValue("");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never;

    registerUpdateIpc(windowStub);

    const handler = registeredHandlers.get("updates:open-release-file");
    expect(handler).toBeDefined();

    const result = (await handler!({} as never)) as {
      opened: boolean;
      path: string | null;
    };
    expect(result).toEqual({
      opened: true,
      path: selectedPath,
      message:
        "Installer opened. Complete installation, then relaunch Tyrum.",
    });
  });

  it("rejects unsupported release file extensions", async () => {
    const { registerUpdateIpc } = await import("../src/main/ipc/update-ipc.js");

    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/not-supported.txt"],
    });

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never;

    registerUpdateIpc(windowStub);

    const handler = registeredHandlers.get("updates:open-release-file");
    expect(handler).toBeDefined();
    await expect(handler!({} as never)).rejects.toThrow("not a supported");
  });

  it("does not run cleanup hooks when install is not ready", async () => {
    const { registerUpdateIpc } = await import("../src/main/ipc/update-ipc.js");
    const beforeInstall = vi.fn(async () => {});
    const allowQuitForUpdate = vi.fn();

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never;

    registerUpdateIpc(windowStub, {
      beforeInstall,
      allowQuitForUpdate,
    });

    const handler = registeredHandlers.get("updates:install");
    expect(handler).toBeDefined();

    await expect(handler!({} as never)).rejects.toThrow("must be downloaded");
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(allowQuitForUpdate).not.toHaveBeenCalled();
  });

  it("rolls back quit flags when install fails after cleanup", async () => {
    const { registerUpdateIpc } = await import("../src/main/ipc/update-ipc.js");
    const beforeInstall = vi.fn(async () => {});
    const allowQuitForUpdate = vi.fn();
    const clearQuitForUpdate = vi.fn();

    quitAndInstallMock.mockImplementation(() => {
      throw new Error("install failed");
    });

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never;

    registerUpdateIpc(windowStub, {
      beforeInstall,
      allowQuitForUpdate,
      clearQuitForUpdate,
    });

    autoUpdaterMock.emit("update-downloaded", { version: "1.1.0" });

    const handler = registeredHandlers.get("updates:install");
    expect(handler).toBeDefined();

    await expect(handler!({} as never)).rejects.toThrow("install failed");
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(allowQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(clearQuitForUpdate).toHaveBeenCalledTimes(1);
  });
});
