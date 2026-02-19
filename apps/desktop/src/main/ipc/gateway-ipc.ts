import { ipcMain, type BrowserWindow } from "electron";
import { GatewayManager } from "../gateway-manager.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, generateToken, encryptToken } from "../config/token-store.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWindowSender } from "./window-sender.js";
import { resolveGatewayBinPath } from "../gateway-bin-path.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import { getGatewayStatusSnapshot } from "./gateway-status.js";

const sender = createWindowSender();

let manager: GatewayManager | null = null;
let ipcRegistered = false;

interface GatewayUiUrls {
  embedUrl: string | null;
  displayUrl: string | null;
  externalUrl: string | null;
}

interface EmbeddedGatewayUiUrlOptions {
  startOnboarding?: boolean;
}

let startPromise: Promise<void> | null = null;

function createAndStoreEmbeddedGatewayToken(config: DesktopNodeConfig): string {
  const token = generateToken();
  config.embedded.tokenRef = encryptToken(token);
  saveConfig(config);
  return token;
}

export function ensureEmbeddedGatewayToken(config: DesktopNodeConfig): string {
  const existingTokenRef = config.embedded.tokenRef;
  if (existingTokenRef) {
    try {
      return decryptToken(existingTokenRef);
    } catch (error) {
      console.warn("Failed to decrypt embedded gateway token; rotating token.", error);
      return createAndStoreEmbeddedGatewayToken(config);
    }
  }

  return createAndStoreEmbeddedGatewayToken(config);
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

function buildEmbeddedGatewayUiUrls(
  port: number,
  token: string,
  options: EmbeddedGatewayUiUrlOptions = {},
): GatewayUiUrls {
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextPath = options.startOnboarding ? "/app/onboarding/start" : "/app";
  const displayUrl = `${baseUrl}${nextPath}`;
  const search = new URLSearchParams({
    token,
    next: nextPath,
  });
  const authUrl = `${baseUrl}/app/auth?${search.toString()}`;

  return {
    embedUrl: authUrl,
    displayUrl,
    externalUrl: authUrl,
  };
}

async function startEmbeddedGatewayWithConfig(
  mgr: GatewayManager,
  config: DesktopNodeConfig,
): Promise<void> {
  if (mgr.status === "running") {
    return;
  }
  if (startPromise) {
    await startPromise;
    return;
  }

  const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  const accessToken = ensureEmbeddedGatewayToken(config);
  const dbPath =
    config.embedded.dbPath || join(tyrumHome, "gateway", "gateway.db");
  const gatewayBin = resolveGatewayBinPath();

  const starter = mgr.start({
    gatewayBin,
    port: config.embedded.port,
    dbPath,
    accessToken,
    host: "127.0.0.1",
  });
  startPromise = starter;
  try {
    await starter;
  } finally {
    if (startPromise === starter) {
      startPromise = null;
    }
  }
}

export async function startEmbeddedGatewayFromConfig(): Promise<{
  status: "running";
  port: number;
}> {
  const mgr = manager;
  if (!mgr) throw new Error("Gateway IPC is not initialized");
  const config = loadConfig();
  await startEmbeddedGatewayWithConfig(mgr, config);
  return {
    status: "running",
    port: config.embedded.port,
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
      return startEmbeddedGatewayFromConfig();
    });

    ipcMain.handle("gateway:stop", async () => {
      const mgr = manager;
      if (!mgr) return { status: "stopped" };
      await mgr.stop();
      return { status: "stopped" };
    });

    ipcMain.handle("gateway:status", async () => {
      const config = loadConfig();
      const mgr = manager;
      return getGatewayStatusSnapshot(mgr?.status, config.embedded.port);
    });

    ipcMain.handle("gateway:ui-urls", async (_event, rawOptions?: unknown) => {
      let startOnboarding = false;
      if (rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)) {
        startOnboarding =
          (rawOptions as { startOnboarding?: unknown }).startOnboarding === true;
      }
      const config = loadConfig();
      if (config.mode === "embedded") {
        const token = ensureEmbeddedGatewayToken(config);
        return buildEmbeddedGatewayUiUrls(config.embedded.port, token, {
          startOnboarding,
        });
      }

      const displayUrl = toHttpAppUrlFromWsUrl(config.remote.wsUrl);
      return {
        embedUrl: displayUrl,
        displayUrl,
        externalUrl: displayUrl,
      } satisfies GatewayUiUrls;
    });

    ipcMain.handle("onboarding:select-mode", async (_event, modeRaw: unknown) => {
      if (modeRaw !== "embedded" && modeRaw !== "remote") {
        throw new Error("onboarding:select-mode requires 'embedded' or 'remote'");
      }

      const config = loadConfig();
      if (modeRaw === "embedded") {
        if (config.mode !== "embedded") {
          config.mode = "embedded";
          saveConfig(config);
        }
        return { mode: "embedded" as const };
      }

      config.mode = "remote";
      saveConfig(config);

      const mgr = manager;
      if (mgr && (mgr.status === "running" || mgr.status === "starting")) {
        await mgr.stop();
      }

      sender.send("status:change", {
        gatewayStatus: "stopped",
        navigateTo: { page: "connection", tab: "remote" },
      });

      return { mode: "remote" as const };
    });
  }

  return manager;
}
