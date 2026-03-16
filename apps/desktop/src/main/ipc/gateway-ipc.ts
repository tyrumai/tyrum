import { ipcMain, type BrowserWindow } from "electron";
import {
  createPinnedNodeTransportState,
  destroyPinnedNodeDispatcher,
  normalizeFingerprint256,
} from "@tyrum/operator-core/node";
import { GatewayManager } from "../gateway-manager.js";
import { configExists, loadConfig } from "../config/store.js";
import { decryptToken } from "../config/token-store.js";
import { createWindowSender } from "./window-sender.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import { getGatewayStatusSnapshot } from "./gateway-status.js";
import {
  buildGatewayHttpFetchInit,
  collectResponseHeaders,
  mirrorGatewayLogEntryToConsole,
  parseGatewayHttpFetchInput,
  resolveGatewayHttpFetchUrl,
} from "./gateway-ipc-helpers.js";
import {
  captureEmbeddedBootstrapToken,
  ensureEmbeddedGatewayToken as ensureEmbeddedGatewayTokenFromState,
  ensureEmbeddedGatewayTokenForRecoveryContext,
  recoverEmbeddedGatewayAccessToken,
  resolveEmbeddedGatewayRuntimeContext,
  type EmbeddedGatewayTokenState,
} from "./gateway-ipc-embedded-token.js";

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

let startPromise: Promise<string> | null = null,
  embeddedGatewayAccessToken: EmbeddedGatewayTokenState = { current: null };

export function ensureEmbeddedGatewayToken(config: DesktopNodeConfig): string {
  return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
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
      if (embeddedGatewayAccessToken.current) return embeddedGatewayAccessToken.current;
      const mgr = manager;
      if (mgr?.status === "running") {
        try {
          return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
        } catch {
          const bootstrap = captureEmbeddedBootstrapToken(mgr, config, embeddedGatewayAccessToken);
          if (bootstrap) return bootstrap;
          return ensureEmbeddedGatewayTokenForRecoveryContext(
            config,
            embeddedGatewayAccessToken,
            "running",
          );
        }
      }
      if (startPromise) {
        try {
          return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
        } catch {
          const bootstrap = mgr
            ? captureEmbeddedBootstrapToken(mgr, config, embeddedGatewayAccessToken)
            : undefined;
          if (bootstrap) return bootstrap;
          return ensureEmbeddedGatewayTokenForRecoveryContext(
            config,
            embeddedGatewayAccessToken,
            "started",
          );
        }
      }

      return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
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
      return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
    } catch {
      const bootstrap = captureEmbeddedBootstrapToken(mgr, config, embeddedGatewayAccessToken);
      if (bootstrap) {
        return bootstrap;
      }
      await mgr.stop();
      embeddedGatewayAccessToken.current = null;
      return await startEmbeddedGatewayWithConfig(mgr, loadConfig());
    }
  }
  if (startPromise) {
    return await startPromise;
  }

  const runtimeContext = resolveEmbeddedGatewayRuntimeContext(config);
  const starter = (async () => {
    let token: string | null = null;
    let recoveryError: Error | null = null;
    try {
      token = ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
    } catch (error) {
      recoveryError = error instanceof Error ? error : new Error(String(error));
      try {
        token = await recoverEmbeddedGatewayAccessToken(
          config,
          mgr,
          runtimeContext,
          embeddedGatewayAccessToken,
        );
        recoveryError = null;
      } catch (recoveryFailure) {
        recoveryError =
          recoveryFailure instanceof Error ? recoveryFailure : new Error(String(recoveryFailure));
      }
    }

    await mgr.start({
      gatewayBin: runtimeContext.gatewayBin.path,
      gatewayBinSource: runtimeContext.gatewayBin.source,
      port: config.embedded.port,
      dbPath: runtimeContext.dbPath,
      home: runtimeContext.tyrumHome,
      host: "127.0.0.1",
    });

    if (token) return token;
    try {
      return ensureEmbeddedGatewayTokenFromState(config, embeddedGatewayAccessToken);
    } catch {
      const bootstrap = captureEmbeddedBootstrapToken(mgr, config, embeddedGatewayAccessToken);
      if (bootstrap) return bootstrap;
    }

    if (recoveryError) {
      throw new Error(
        `Embedded gateway started but automatic token recovery failed: ${recoveryError.message}`,
      );
    }
    throw new Error("Embedded gateway started but no usable access token could be recovered.");
  })();
  startPromise = starter;
  try {
    return await starter;
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
  return { status: "running", port: config.embedded.port };
}

function ensureGatewayManager(): GatewayManager {
  if (manager) return manager;
  manager = new GatewayManager();
  manager.on("log", (entry) => {
    mirrorGatewayLogEntryToConsole(entry);
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
  embeddedGatewayAccessToken.current = null;
  return { status: "stopped" };
}

export const stopEmbeddedGatewayFromMainProcess = handleGatewayStop;
export async function resetGatewayIpcStateForTests(): Promise<void> {
  try {
    await manager?.stop();
  } catch {}
  manager?.removeAllListeners();
  [manager, ipcRegistered, startPromise] = [null, false, null];
  embeddedGatewayAccessToken.current = null;
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
