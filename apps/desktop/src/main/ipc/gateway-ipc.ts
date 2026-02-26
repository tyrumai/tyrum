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

interface OperatorConnectionInfo {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
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

function toHttpBaseUrlFromWsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function resolveOperatorConnection(config: DesktopNodeConfig): OperatorConnectionInfo {
  if (config.mode === "embedded") {
    const token = ensureEmbeddedGatewayToken(config);
    const port = config.embedded.port;
    return {
      mode: "embedded",
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      httpBaseUrl: `http://127.0.0.1:${port}/`,
      token,
      tlsCertFingerprint256: "",
    };
  }

  const httpBaseUrl = toHttpBaseUrlFromWsUrl(config.remote.wsUrl);
  if (!httpBaseUrl) {
    throw new Error("Remote gateway WS URL is invalid; expected a ws:// or wss:// URL.");
  }

  const token = config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "";
  const tlsCertFingerprint256 =
    typeof config.remote.tlsCertFingerprint256 === "string"
      ? config.remote.tlsCertFingerprint256
      : "";
  return {
    mode: "remote",
    wsUrl: config.remote.wsUrl,
    httpBaseUrl,
    token,
    tlsCertFingerprint256,
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
  const dbPath = config.embedded.dbPath || join(tyrumHome, "gateway", "gateway.db");
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

    ipcMain.handle("gateway:operator-connection", async () => {
      const config = loadConfig();
      return resolveOperatorConnection(config);
    });

    ipcMain.handle("gateway:http-fetch", async (_event, rawInput: unknown) => {
      if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
        throw new Error("gateway:http-fetch requires a plain object");
      }

      const input = rawInput as {
        url?: unknown;
        init?: unknown;
      };

      if (typeof input.url !== "string") {
        throw new Error("gateway:http-fetch requires url:string");
      }

      const config = loadConfig();
      const { httpBaseUrl } = resolveOperatorConnection(config);
      const allowedOrigin = new URL(httpBaseUrl).origin;

      let requestUrl: URL;
      try {
        requestUrl = new URL(input.url);
      } catch {
        throw new Error("gateway:http-fetch requires an absolute URL");
      }

      if (requestUrl.origin !== allowedOrigin) {
        throw new Error("Only the configured gateway origin is allowed");
      }
      if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
        throw new Error("Only http/https URLs are allowed");
      }

      const init: RequestInit =
        input.init && typeof input.init === "object" && !Array.isArray(input.init)
          ? (input.init as RequestInit)
          : {};

      // The renderer always provides serializable primitives; ensure we pass plain objects through.
      const res = await fetch(requestUrl.toString(), init);
      const bodyText = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        status: res.status,
        headers,
        bodyText,
      };
    });
  }

  return manager;
}
