import { app, BrowserWindow, dialog, Menu, screen, shell } from "electron";
import { join } from "node:path";
import { registerGatewayIpc, startEmbeddedGatewayFromConfig } from "./ipc/gateway-ipc.js";
import { registerNodeIpc, shutdownNodeResources } from "./ipc/node-ipc.js";
import { registerConfigIpc } from "./ipc/config-ipc.js";
import { registerUpdateIpc } from "./ipc/update-ipc.js";
import { registerThemeIpc } from "./ipc/theme-ipc.js";
import type { GatewayManager } from "./gateway-manager.js";
import { MAIN_WINDOW_OPTIONS } from "./window-options.js";
import { configExists, loadConfig } from "./config/store.js";
import { setWindowsAppUserModelId, setupSingleInstance } from "./single-instance.js";
import { configureMacAboutPanel } from "./platform/os-integrations.js";
import { buildApplicationMenuTemplate } from "./menu.js";
import { registerContextMenus } from "./context-menu.js";
import { isSafeExternalUrl } from "./safe-external-url.js";
import {
  captureWindowState,
  ensureVisibleBounds,
  loadWindowState,
  saveWindowState,
} from "./window-state.js";

app.setName?.("Tyrum");

let mainWindow: BrowserWindow | null = null;
let gatewayManager: GatewayManager | null = null;
let isQuitting = false;
let isQuittingForUpdate = false;
let mainWindowReadyToShow = false;
let mainWindowPendingFocus = false;

setWindowsAppUserModelId(app);

const didAcquireSingleInstanceLock = setupSingleInstance({
  app,
  getMainWindow: () => {
    if (!mainWindow) {
      return null;
    }

    const window = mainWindow;
    return {
      isMinimized: () => window.isMinimized(),
      restore: () => window.restore(),
      show: () => {
        if (!mainWindowReadyToShow) {
          mainWindowPendingFocus = true;
          return;
        }
        window.show();
      },
      focus: () => {
        if (!mainWindowReadyToShow) {
          mainWindowPendingFocus = true;
          return;
        }
        window.focus();
      },
    };
  },
});

async function shutdownAppResources(): Promise<void> {
  try {
    await shutdownNodeResources();
  } catch (err) {
    console.error("Failed to shutdown node resources", err);
  }

  try {
    await gatewayManager?.stop();
  } catch (err) {
    console.error("Failed to stop embedded gateway", err);
  }
}

export async function maybeAutoStartEmbeddedGatewayOnLaunch(): Promise<void> {
  const hadConfig = configExists();
  const config = loadConfig();
  const shouldStartEmbedded = !hadConfig || config.mode === "embedded";
  if (!shouldStartEmbedded) {
    return;
  }

  try {
    await startEmbeddedGatewayFromConfig();
  } catch (err) {
    console.error("Failed to auto-start embedded gateway on launch", err);
  }
}

function registerNavigationGuardrails(window: BrowserWindow): void {
  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      const isAllowedDev = devOrigin !== null && parsed.origin === devOrigin;
      const isAllowedFile = parsed.protocol === "file:";
      if (isAllowedDev || isAllowedFile) {
        return;
      }
    } catch {
      // Treat invalid URLs as disallowed navigations.
    }

    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });
}

function createWindow(): void {
  const userDataPath = app.getPath("userData");
  const persistedState = loadWindowState(userDataPath);

  let restoredBounds: ReturnType<typeof ensureVisibleBounds> | null = null;
  if (persistedState) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays();
    const orderedDisplays = [
      primaryDisplay,
      ...displays.filter((display) => display.id !== primaryDisplay.id),
    ];
    restoredBounds = ensureVisibleBounds(
      persistedState.bounds,
      orderedDisplays.map((display) => display.workArea),
    );
  }

  const window = new BrowserWindow(
    restoredBounds ? { ...MAIN_WINDOW_OPTIONS, ...restoredBounds } : MAIN_WINDOW_OPTIONS,
  );
  mainWindow = window;
  mainWindowReadyToShow = false;
  mainWindowPendingFocus = false;

  let lastKnownIsMaximized = persistedState?.isMaximized ?? false;
  if (lastKnownIsMaximized) {
    window.maximize();
  }

  let windowStateSaveTimer: NodeJS.Timeout | null = null;
  const scheduleWindowStateSave = (): void => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
    }

    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null;
      saveWindowState(
        userDataPath,
        captureWindowState(window, { isMaximized: lastKnownIsMaximized }),
      );
    }, 500);
  };

  window.on("move", scheduleWindowStateSave);
  window.on("resize", scheduleWindowStateSave);
  window.on("maximize", () => {
    lastKnownIsMaximized = true;
    scheduleWindowStateSave();
  });
  window.on("unmaximize", () => {
    lastKnownIsMaximized = false;
    scheduleWindowStateSave();
  });
  window.on("close", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    saveWindowState(
      userDataPath,
      captureWindowState(window, { isMaximized: lastKnownIsMaximized }),
    );
  });

  window.once("ready-to-show", () => {
    mainWindowReadyToShow = true;
    window.show();
    if (mainWindowPendingFocus) {
      mainWindowPendingFocus = false;
      window.focus();
    }
  });

  registerNavigationGuardrails(window);

  registerConfigIpc();
  gatewayManager = registerGatewayIpc(window);
  registerNodeIpc(window);
  registerUpdateIpc(window, {
    beforeInstall: shutdownAppResources,
    allowQuitForUpdate: () => {
      isQuittingForUpdate = true;
      isQuitting = true;
    },
    clearQuitForUpdate: () => {
      isQuittingForUpdate = false;
      isQuitting = false;
    },
  });
  registerThemeIpc(mainWindow);

  if (process.env["VITE_DEV_SERVER_URL"]) {
    window.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  void maybeAutoStartEmbeddedGatewayOnLaunch();

  window.on("closed", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    mainWindow = null;
  });
}

if (didAcquireSingleInstanceLock) {
  registerContextMenus({ app, BrowserWindow, Menu, shell });
  app.whenReady().then(() => {
    configureMacAboutPanel(app, process.platform);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildApplicationMenuTemplate({
          appName: app.name,
          platform: process.platform,
          isDev: !app.isPackaged,
          onShowAbout: () => {
            const parentWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
            const options: Electron.MessageBoxOptions = {
              type: "info",
              title: `About ${app.name}`,
              message: app.name,
              detail: `Version ${app.getVersion()}`,
              buttons: ["OK"],
            };

            if (parentWindow && !parentWindow.isDestroyed()) {
              void dialog.showMessageBox(parentWindow, options);
              return;
            }

            void dialog.showMessageBox(options);
          },
          onRequestNavigate: (request) => {
            const win = mainWindow;
            if (!win) return;
            if (win.isDestroyed() || win.webContents.isDestroyed()) return;
            win.webContents.send("navigation:request", request);
          },
        }),
      ),
    );
    createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (mainWindow === null) createWindow();
  });
  app.on("before-quit", (event) => {
    if (isQuittingForUpdate) return;
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    void (async () => {
      try {
        await shutdownAppResources();
      } finally {
        app.quit();
      }
    })();
  });
}
