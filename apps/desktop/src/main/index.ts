import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { registerGatewayIpc, startEmbeddedGatewayFromConfig } from "./ipc/gateway-ipc.js";
import { registerNodeIpc, shutdownNodeResources } from "./ipc/node-ipc.js";
import { registerConfigIpc } from "./ipc/config-ipc.js";
import { registerUpdateIpc } from "./ipc/update-ipc.js";
import type { GatewayManager } from "./gateway-manager.js";
import { MAIN_WINDOW_OPTIONS } from "./window-options.js";
import { configExists, loadConfig } from "./config/store.js";

app.setName?.("Tyrum");

let mainWindow: BrowserWindow | null = null;
let gatewayManager: GatewayManager | null = null;
let isQuitting = false;
let appIpcRegistered = false;
let isQuittingForUpdate = false;
const startupState = { launchOnboarding: false };

function registerAppIpc(): void {
  if (appIpcRegistered) return;
  appIpcRegistered = true;

  ipcMain.handle("app:get-startup-state", () => {
    const snapshot = { ...startupState };
    startupState.launchOnboarding = false;
    return snapshot;
  });
}

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
  startupState.launchOnboarding = !hadConfig;
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

function createWindow(): void {
  mainWindow = new BrowserWindow(MAIN_WINDOW_OPTIONS);

  registerAppIpc();
  registerConfigIpc();
  gatewayManager = registerGatewayIpc(mainWindow);
  registerNodeIpc(mainWindow);
  registerUpdateIpc(mainWindow, {
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

  if (process.env["VITE_DEV_SERVER_URL"]) {
    mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  void maybeAutoStartEmbeddedGatewayOnLaunch();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
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
