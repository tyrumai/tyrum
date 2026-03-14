import { ipcMain, type BrowserWindow } from "electron";
import {
  createPinnedNodeTransportState,
  destroyPinnedNodeDispatcher,
  normalizeFingerprint256,
} from "@tyrum/operator-core/node";
import { GatewayManager } from "../gateway-manager.js";
import { configExists, loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, encryptToken } from "../config/token-store.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWindowSender } from "./window-sender.js";
import { resolveGatewayBin } from "../gateway-bin-path.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import { getGatewayStatusSnapshot } from "./gateway-status.js";

const sender = createWindowSender();
let manager: GatewayManager | null = null,
  ipcRegistered = false;

type PinnedGatewayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

type PinnedGatewayFetchState = {
  key: string;
  fetchImpl: PinnedGatewayFetch;
  dispatcher: { destroy?: () => Promise<void> | void };
};

let pinnedGatewayFetchState: PinnedGatewayFetchState | null = null;

function resolveTlsPinSettings(config: DesktopNodeConfig): {
  pinRaw: string;
  allowSelfSigned: boolean;
} {
  return {
    pinRaw:
      config.mode === "remote" && typeof config.remote.tlsCertFingerprint256 === "string"
        ? config.remote.tlsCertFingerprint256.trim()
        : "",
    allowSelfSigned: config.mode === "remote" ? Boolean(config.remote.tlsAllowSelfSigned) : false,
  };
}

async function destroyPinnedGatewayFetchState(): Promise<void> {
  if (!pinnedGatewayFetchState) return;
  await destroyPinnedNodeDispatcher(pinnedGatewayFetchState.dispatcher);
  pinnedGatewayFetchState = null;
}

async function createPinnedGatewayFetchState(options: {
  expectedFingerprint256: string;
  allowSelfSigned: boolean;
  pinRaw: string;
  key: string;
}): Promise<PinnedGatewayFetchState> {
  const transport = await createPinnedNodeTransportState({
    pinRaw: options.pinRaw,
    expectedFingerprint256: options.expectedFingerprint256,
    allowSelfSigned: options.allowSelfSigned,
  });

  return {
    key: options.key,
    fetchImpl: transport.fetchImpl,
    dispatcher: transport.dispatcher,
  };
}

async function resolvePinnedGatewayFetchState(
  config: DesktopNodeConfig,
): Promise<PinnedGatewayFetchState | null> {
  const { pinRaw, allowSelfSigned } = resolveTlsPinSettings(config);

  if (!pinRaw) {
    if (allowSelfSigned) {
      throw new Error("remote.tlsAllowSelfSigned requires remote.tlsCertFingerprint256.");
    }
    await destroyPinnedGatewayFetchState();
    return null;
  }

  const expectedFingerprint256 = normalizeFingerprint256(pinRaw);
  if (!expectedFingerprint256) {
    throw new Error("remote.tlsCertFingerprint256 must be a SHA-256 hex fingerprint.");
  }

  const key = `${expectedFingerprint256}:${allowSelfSigned ? "self" : "strict"}`;
  if (pinnedGatewayFetchState?.key === key) {
    return pinnedGatewayFetchState;
  }

  await destroyPinnedGatewayFetchState();
  pinnedGatewayFetchState = await createPinnedGatewayFetchState({
    expectedFingerprint256,
    allowSelfSigned,
    pinRaw,
    key,
  });

  return pinnedGatewayFetchState;
}

export interface OperatorConnectionInfo {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
  tlsAllowSelfSigned: boolean;
}

let startPromise: Promise<void> | null = null,
  embeddedGatewayAccessToken: string | null = null;

type EmbeddedGatewayTokenRecoveryContext = "running" | "started";

const EMBEDDED_GATEWAY_TOKEN_RECOVERY_MESSAGES: Record<
  EmbeddedGatewayTokenRecoveryContext,
  {
    missingTokenRefError: string;
    decryptWarn: string;
    decryptFailError: string;
    invalidFormatWarn: string;
    invalidFormatFailError: string;
  }
> = {
  running: {
    missingTokenRefError:
      "Embedded gateway is running but the stored token is missing. Restart the embedded gateway from the Desktop app.",
    decryptWarn:
      "Failed to decrypt embedded gateway token while the gateway is running; refusing to rotate token.",
    decryptFailError:
      "Embedded gateway token could not be decrypted while the gateway is running. Restart the embedded gateway from the Desktop app.",
    invalidFormatWarn:
      "Invalid embedded gateway token format while the gateway is running; refusing to rotate token.",
    invalidFormatFailError:
      "Embedded gateway token has an invalid format while the gateway is running. Restart the embedded gateway from the Desktop app.",
  },
  started: {
    missingTokenRefError:
      "Embedded gateway started but the stored token is missing. Restart the embedded gateway from the Desktop app.",
    decryptWarn: "Failed to decrypt embedded gateway token after start; refusing to rotate token.",
    decryptFailError:
      "Embedded gateway token could not be decrypted after starting. Restart the embedded gateway from the Desktop app.",
    invalidFormatWarn:
      "Invalid embedded gateway token format after start; refusing to rotate token.",
    invalidFormatFailError:
      "Embedded gateway token has an invalid format after starting. Restart the embedded gateway from the Desktop app.",
  },
};

const TYRUM_TOKEN_PATTERN = /^tyrum-token\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isValidEmbeddedGatewayToken(token: string): boolean {
  return TYRUM_TOKEN_PATTERN.test(token.trim());
}

function persistEmbeddedGatewayToken(config: DesktopNodeConfig, token: string): void {
  config.embedded.tokenRef = encryptToken(token);
  saveConfig(config);
  embeddedGatewayAccessToken = token;
}

function resolveEmbeddedGatewayDbPath(config: DesktopNodeConfig, tyrumHome: string): string {
  const configured = config.embedded.dbPath.trim();
  if (configured) return configured;

  const currentPath = join(tyrumHome, "gateway.db");
  const legacyPath = join(tyrumHome, "gateway", "gateway.db");

  try {
    if (existsSync(currentPath)) return currentPath;
  } catch {
    // ignore
  }

  try {
    if (existsSync(legacyPath)) return legacyPath;
  } catch {
    // ignore
  }

  return currentPath;
}

function loadEmbeddedGatewayAccessToken(
  config: DesktopNodeConfig,
  messages: {
    missingTokenRefError: string;
    decryptWarn: string;
    decryptFailError: string;
    invalidFormatWarn: string;
    invalidFormatFailError: string;
  },
): string {
  if (embeddedGatewayAccessToken) return embeddedGatewayAccessToken;

  const tokenRef = config.embedded.tokenRef;
  if (!tokenRef) {
    throw new Error(messages.missingTokenRefError);
  }

  let decrypted: string;
  try {
    decrypted = decryptToken(tokenRef);
  } catch (error) {
    console.warn(messages.decryptWarn, error);
    throw new Error(messages.decryptFailError);
  }

  if (!isValidEmbeddedGatewayToken(decrypted)) {
    console.warn(messages.invalidFormatWarn, new Error("Invalid embedded gateway token format"));
    throw new Error(messages.invalidFormatFailError);
  }

  embeddedGatewayAccessToken = decrypted;
  return decrypted;
}

function recoverEmbeddedGatewayAccessToken(
  config: DesktopNodeConfig,
  context: EmbeddedGatewayTokenRecoveryContext,
): string {
  return loadEmbeddedGatewayAccessToken(config, EMBEDDED_GATEWAY_TOKEN_RECOVERY_MESSAGES[context]);
}

export function ensureEmbeddedGatewayToken(config: DesktopNodeConfig): string {
  return loadEmbeddedGatewayAccessToken(config, {
    missingTokenRefError:
      "Embedded gateway token is missing. Start the embedded gateway from the Desktop app to bootstrap a token.",
    decryptWarn: "Failed to decrypt embedded gateway token; restart the embedded gateway.",
    decryptFailError:
      "Embedded gateway token could not be decrypted. Restart the embedded gateway from the Desktop app.",
    invalidFormatWarn: "Invalid embedded gateway token format; restart the embedded gateway.",
    invalidFormatFailError:
      "Embedded gateway token has an invalid format. Restart the embedded gateway from the Desktop app.",
  });
}

function toHttpBaseUrlFromWsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else {
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

function resolveOperatorHttpBaseUrl(config: DesktopNodeConfig): string {
  if (config.mode === "embedded") {
    return `http://127.0.0.1:${config.embedded.port}/`;
  }

  const httpBaseUrl = toHttpBaseUrlFromWsUrl(config.remote.wsUrl);
  if (!httpBaseUrl) {
    throw new Error("Remote gateway wsUrl is invalid; expected ws:// or wss://.");
  }

  return httpBaseUrl;
}

export function resolveOperatorConnection(config: DesktopNodeConfig): OperatorConnectionInfo {
  if (config.mode === "embedded") {
    const token = (() => {
      if (embeddedGatewayAccessToken) return embeddedGatewayAccessToken;
      const mgr = manager;
      if (mgr?.status === "running") {
        return recoverEmbeddedGatewayAccessToken(config, "running");
      }
      if (startPromise) {
        return recoverEmbeddedGatewayAccessToken(config, "started");
      }

      const ensured = ensureEmbeddedGatewayToken(config);
      embeddedGatewayAccessToken = ensured;
      return ensured;
    })();
    const port = config.embedded.port;
    return {
      mode: "embedded",
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      httpBaseUrl: resolveOperatorHttpBaseUrl(config),
      token,
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    };
  }

  // Remote deployments may still use opaque GATEWAY_TOKEN values, so do not
  // apply the embedded bootstrap-token format check here.
  const token = config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "";
  const tlsCertFingerprint256 =
    typeof config.remote.tlsCertFingerprint256 === "string"
      ? config.remote.tlsCertFingerprint256
      : "";
  const tlsAllowSelfSigned = Boolean(config.remote.tlsAllowSelfSigned);
  return {
    mode: "remote",
    wsUrl: config.remote.wsUrl,
    httpBaseUrl: resolveOperatorHttpBaseUrl(config),
    token,
    tlsCertFingerprint256,
    tlsAllowSelfSigned,
  };
}

async function startEmbeddedGatewayWithConfig(
  mgr: GatewayManager,
  config: DesktopNodeConfig,
): Promise<string> {
  if (mgr.status === "running") {
    try {
      return ensureEmbeddedGatewayToken(config);
    } catch {
      const bootstrap = mgr.getBootstrapToken("default-tenant-admin");
      if (bootstrap && isValidEmbeddedGatewayToken(bootstrap)) {
        persistEmbeddedGatewayToken(config, bootstrap);
        return bootstrap;
      }
      return recoverEmbeddedGatewayAccessToken(config, "running");
    }
  }
  if (startPromise) {
    await startPromise;
    return recoverEmbeddedGatewayAccessToken(config, "started");
  }

  const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  const dbPath = resolveEmbeddedGatewayDbPath(config, tyrumHome);
  const gatewayBin = resolveGatewayBin();

  const starter = mgr.start({
    gatewayBin: gatewayBin.path,
    gatewayBinSource: gatewayBin.source,
    port: config.embedded.port,
    dbPath,
    home: tyrumHome,
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

  try {
    return ensureEmbeddedGatewayToken(config);
  } catch {
    const bootstrap = mgr.getBootstrapToken("default-tenant-admin");
    if (bootstrap && isValidEmbeddedGatewayToken(bootstrap)) {
      persistEmbeddedGatewayToken(config, bootstrap);
      return bootstrap;
    }
  }

  throw new Error(
    "Embedded gateway started but no bootstrap token was captured. Delete the embedded gateway database or issue a new token, then restart the embedded gateway.",
  );
}

export async function startEmbeddedGatewayFromConfig(): Promise<{
  status: "running";
  port: number;
}> {
  const mgr = manager;
  if (!mgr) throw new Error("Gateway IPC is not initialized");
  const config = loadConfig();
  await startEmbeddedGatewayWithConfig(mgr, config);
  return { status: "running", port: config.embedded.port };
}

function ensureGatewayManager(): GatewayManager {
  if (manager) return manager;
  manager = new GatewayManager();
  manager.on("log", (entry) => {
    sender.send("log:entry", { source: "gateway", ...entry });
  });
  manager.on("status-change", (status) => {
    sender.send("status:change", { gatewayStatus: status });
  });
  return manager;
}

async function handleGatewayStop(): Promise<{ status: "stopped" }> {
  const mgr = manager;
  if (!mgr) return { status: "stopped" };
  await mgr.stop();
  embeddedGatewayAccessToken = null;
  return { status: "stopped" };
}

export const stopEmbeddedGatewayFromMainProcess = handleGatewayStop;
export async function resetGatewayIpcStateForTests(): Promise<void> {
  try {
    await manager?.stop();
  } catch {}
  manager?.removeAllListeners();
  [manager, ipcRegistered, startPromise, embeddedGatewayAccessToken] = [null, false, null, null];
  sender.setWindow(null);
  await destroyPinnedGatewayFetchState();
}

async function handleGatewayStatus(): Promise<ReturnType<typeof getGatewayStatusSnapshot>> {
  return getGatewayStatusSnapshot(manager?.status, loadConfig().embedded.port);
}

async function handleGatewayOperatorConnection(): Promise<OperatorConnectionInfo> {
  if (!configExists()) {
    throw new Error("Desktop is not configured yet. Choose Embedded or Remote mode first.");
  }
  const config = loadConfig();
  if (config.mode === "embedded") {
    const mgr = manager;
    if (!mgr) throw new Error("Gateway IPC is not initialized");
    const token = await startEmbeddedGatewayWithConfig(mgr, config);
    const port = config.embedded.port;
    return {
      mode: "embedded",
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      httpBaseUrl: resolveOperatorHttpBaseUrl(config),
      token,
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    } satisfies OperatorConnectionInfo;
  }
  return resolveOperatorConnection(config);
}

function parseGatewayHttpFetchInput(rawInput: unknown): {
  url: string;
  rawInit: Record<string, unknown> | undefined;
} {
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

  const rawInit =
    input.init && typeof input.init === "object" && !Array.isArray(input.init)
      ? (input.init as Record<string, unknown>)
      : undefined;

  return { url: input.url, rawInit };
}

function resolveGatewayHttpFetchUrl(rawUrl: string, allowedOrigin: string): URL {
  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
  } catch {
    throw new Error("gateway:http-fetch requires an absolute URL");
  }

  if (requestUrl.origin !== allowedOrigin) {
    throw new Error("Only the configured gateway origin is allowed");
  }
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  return requestUrl;
}

function buildGatewayHttpFetchInit(rawInit: Record<string, unknown> | undefined): RequestInit {
  const method = typeof rawInit?.["method"] === "string" ? rawInit["method"] : undefined;

  const rawHeaders =
    rawInit?.["headers"] &&
    typeof rawInit["headers"] === "object" &&
    !Array.isArray(rawInit["headers"])
      ? (rawInit["headers"] as Record<string, unknown>)
      : undefined;

  const body = typeof rawInit?.["body"] === "string" ? rawInit["body"] : undefined;

  const requestHeaders: Record<string, string> | undefined = rawHeaders
    ? Object.fromEntries(
        Object.entries(rawHeaders).flatMap(([key, value]) => {
          if (typeof value !== "string") return [];
          return [[key, value]];
        }),
      )
    : undefined;

  if (requestHeaders) {
    for (const headerName of Object.keys(requestHeaders)) {
      if (headerName.trim().toLowerCase() === "cookie") {
        throw new Error("Cookie header is not allowed");
      }
    }
  }

  return {
    method,
    headers: requestHeaders,
    body,
    redirect: "manual",
  };
}

function collectResponseHeaders(response: Response): Record<string, string> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  return responseHeaders;
}

async function handleGatewayHttpFetch(
  _event: Electron.IpcMainInvokeEvent,
  rawInput: unknown,
): Promise<{
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}> {
  const { url, rawInit } = parseGatewayHttpFetchInput(rawInput);

  const config = loadConfig();
  const allowedOrigin = new URL(resolveOperatorHttpBaseUrl(config)).origin;

  const requestUrl = resolveGatewayHttpFetchUrl(url, allowedOrigin);
  const init = buildGatewayHttpFetchInit(rawInit);
  const pinned =
    requestUrl.protocol === "https:" ? await resolvePinnedGatewayFetchState(config) : null;
  const res = pinned
    ? await pinned.fetchImpl(requestUrl.toString(), { ...init, dispatcher: pinned.dispatcher })
    : await fetch(requestUrl.toString(), init);
  const bodyText = await res.text();

  return {
    status: res.status,
    headers: collectResponseHeaders(res),
    bodyText,
  };
}

export function registerGatewayIpc(window: BrowserWindow): GatewayManager {
  sender.setWindow(window);

  const mgr = ensureGatewayManager();

  if (!ipcRegistered) {
    ipcRegistered = true;

    ipcMain.handle("gateway:start", startEmbeddedGatewayFromConfig);
    ipcMain.handle("gateway:stop", handleGatewayStop);
    ipcMain.handle("gateway:status", handleGatewayStatus);
    ipcMain.handle("gateway:operator-connection", handleGatewayOperatorConnection);
    ipcMain.handle("gateway:http-fetch", handleGatewayHttpFetch);
  }

  return mgr;
}
