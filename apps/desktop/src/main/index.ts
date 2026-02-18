import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerGatewayIpc } from "./ipc/gateway-ipc.js";
import { registerNodeIpc, shutdownNodeResources } from "./ipc/node-ipc.js";
import { registerConfigIpc } from "./ipc/config-ipc.js";
import type { GatewayManager } from "./gateway-manager.js";

let mainWindow: BrowserWindow | null = null;
let gatewayManager: GatewayManager | null = null;
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerConfigIpc();
  gatewayManager = registerGatewayIpc(mainWindow);
  registerNodeIpc(mainWindow);

  if (process.env["VITE_DEV_SERVER_URL"]) {
    mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

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
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  void (async () => {
    try {
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
    } finally {
      app.quit();
    }
  })();
});
