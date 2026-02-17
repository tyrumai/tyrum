import { ipcMain, type BrowserWindow } from "electron";
import { GatewayManager } from "../gateway-manager.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, generateToken, encryptToken } from "../config/token-store.js";
import { join } from "node:path";
import { homedir } from "node:os";

export function registerGatewayIpc(window: BrowserWindow): GatewayManager {
  const manager = new GatewayManager();

  // Forward logs to renderer
  manager.on("log", (entry) => {
    window.webContents.send("log:entry", { source: "gateway", ...entry });
  });

  manager.on("status-change", (status) => {
    window.webContents.send("status:change", { gateway: status });
  });

  ipcMain.handle("gateway:start", async () => {
    const config = loadConfig();
    const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");

    // Resolve or generate token
    let wsToken: string;
    if (config.embedded.tokenRef) {
      wsToken = decryptToken(config.embedded.tokenRef);
    } else {
      wsToken = generateToken();
      const tokenRef = encryptToken(wsToken);
      config.embedded.tokenRef = tokenRef;
      saveConfig(config);
    }

    const dbPath =
      config.embedded.dbPath || join(tyrumHome, "gateway", "gateway.db");

    // Locate the gateway binary relative to this module
    const gatewayBin = join(
      import.meta.dirname,
      "../../../../packages/gateway/dist/index.mjs",
    );

    await manager.start({
      gatewayBin,
      port: config.embedded.port,
      dbPath,
      wsToken,
      host: "127.0.0.1",
    });

    return { status: "running", port: config.embedded.port, wsToken };
  });

  ipcMain.handle("gateway:stop", async () => {
    await manager.stop();
    return { status: "stopped" };
  });

  return manager;
}
