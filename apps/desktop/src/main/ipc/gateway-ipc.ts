import { ipcMain, type BrowserWindow } from "electron";
import { GatewayManager } from "../gateway-manager.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, generateToken, encryptToken } from "../config/token-store.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWindowSender } from "./window-sender.js";

const sender = createWindowSender();

let manager: GatewayManager | null = null;
let ipcRegistered = false;

export function registerGatewayIpc(window: BrowserWindow): GatewayManager {
  sender.setWindow(window);

  if (!manager) {
    manager = new GatewayManager();

    // Forward logs to renderer
    manager.on("log", (entry) => {
      sender.send("log:entry", { source: "gateway", ...entry });
    });

    manager.on("status-change", (status) => {
      sender.send("status:change", { gatewayStatus: status });
    });
  }

  if (!ipcRegistered) {
    ipcRegistered = true;

    ipcMain.handle("gateway:start", async () => {
      const mgr = manager;
      if (!mgr) throw new Error("Gateway IPC is not initialized");

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

      await mgr.start({
        gatewayBin,
        port: config.embedded.port,
        dbPath,
        wsToken,
        host: "127.0.0.1",
      });

      return {
        status: "running",
        port: config.embedded.port,
      };
    });

    ipcMain.handle("gateway:stop", async () => {
      const mgr = manager;
      if (!mgr) return { status: "stopped" };
      await mgr.stop();
      return { status: "stopped" };
    });
  }

  return manager;
}
