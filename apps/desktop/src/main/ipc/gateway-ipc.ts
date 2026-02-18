import { ipcMain, type BrowserWindow } from "electron";
import { GatewayManager } from "../gateway-manager.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, generateToken, encryptToken } from "../config/token-store.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWindowSender } from "./window-sender.js";
import { resolveGatewayBinPath } from "../gateway-bin-path.js";
import type { DesktopNodeConfig } from "../config/schema.js";

const sender = createWindowSender();

let manager: GatewayManager | null = null;
let ipcRegistered = false;

interface GatewayUiUrls {
  embedUrl: string | null;
  displayUrl: string | null;
  externalUrl: string | null;
}

function ensureEmbeddedGatewayToken(config: DesktopNodeConfig): string {
  const existingTokenRef = config.embedded.tokenRef;
  if (existingTokenRef) {
    return decryptToken(existingTokenRef);
  }

  const token = generateToken();
  config.embedded.tokenRef = encryptToken(token);
  saveConfig(config);
  return token;
}

function toHttpAppUrlFromWsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.pathname = "/app";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildEmbeddedGatewayUiUrls(port: number, token: string): GatewayUiUrls {
  const baseUrl = `http://127.0.0.1:${port}`;
  const displayUrl = `${baseUrl}/app`;
  const search = new URLSearchParams({
    token,
    next: "/app",
  });
  const authUrl = `${baseUrl}/app/auth?${search.toString()}`;

  return {
    embedUrl: authUrl,
    displayUrl,
    externalUrl: authUrl,
  };
}

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
      const wsToken = ensureEmbeddedGatewayToken(config);

      const dbPath =
        config.embedded.dbPath || join(tyrumHome, "gateway", "gateway.db");

      const gatewayBin = resolveGatewayBinPath();

      await mgr.start({
        gatewayBin,
        port: config.embedded.port,
        dbPath,
        wsToken,
        adminToken: wsToken,
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

    ipcMain.handle("gateway:ui-urls", async () => {
      const config = loadConfig();
      if (config.mode === "embedded") {
        const token = ensureEmbeddedGatewayToken(config);
        return buildEmbeddedGatewayUiUrls(config.embedded.port, token);
      }

      const displayUrl = toHttpAppUrlFromWsUrl(config.remote.wsUrl);
      return {
        embedUrl: displayUrl,
        displayUrl,
        externalUrl: displayUrl,
      } satisfies GatewayUiUrls;
    });
  }

  return manager;
}
