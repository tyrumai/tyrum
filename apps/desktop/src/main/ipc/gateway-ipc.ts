import { ipcMain, type BrowserWindow } from "electron";
import { normalizeFingerprint256 } from "@tyrum/operator-core";
import { GatewayManager } from "../gateway-manager.js";
import { configExists, loadConfig, saveConfig } from "../config/store.js";
import { decryptToken, encryptToken } from "../config/token-store.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWindowSender } from "./window-sender.js";
import { resolveGatewayBinPath } from "../gateway-bin-path.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import { getGatewayStatusSnapshot } from "./gateway-status.js";

const sender = createWindowSender();

let manager: GatewayManager | null = null;
let ipcRegistered = false;

type PinnedGatewayFetchState = {
  key: string;
  fetchImpl: typeof fetch;
  dispatcher: { destroy?: () => Promise<void> | void };
};

let pinnedGatewayFetchState: PinnedGatewayFetchState | null = null;

async function resolvePinnedGatewayFetchState(
  config: DesktopNodeConfig,
): Promise<PinnedGatewayFetchState | null> {
  const pinRaw =
    config.mode === "remote" && typeof config.remote.tlsCertFingerprint256 === "string"
      ? config.remote.tlsCertFingerprint256.trim()
      : "";
  const allowSelfSigned =
    config.mode === "remote" ? Boolean(config.remote.tlsAllowSelfSigned) : false;

  if (!pinRaw) {
    if (allowSelfSigned) {
      throw new Error("remote.tlsAllowSelfSigned requires remote.tlsCertFingerprint256.");
    }
    if (pinnedGatewayFetchState) {
      try {
        await pinnedGatewayFetchState.dispatcher.destroy?.();
      } catch {
        // ignore
      }
      pinnedGatewayFetchState = null;
    }
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

  if (pinnedGatewayFetchState) {
    try {
      await pinnedGatewayFetchState.dispatcher.destroy?.();
    } catch {
      // ignore
    }
    pinnedGatewayFetchState = null;
  }

  const undici = await import("undici");
  const tls = await import("node:tls");

  const agent = new undici.Agent({
    connect: (opts, callback) => {
      const portRaw = opts.port;
      const port =
        typeof portRaw === "number" ? portRaw : Number.parseInt(String(portRaw ?? ""), 10);
      const hostnameRaw = opts.hostname;
      const hostname = typeof hostnameRaw === "string" ? hostnameRaw : String(hostnameRaw ?? "");
      const servername =
        typeof opts.servername === "string" && opts.servername.trim() ? opts.servername : hostname;

      if (!hostname || !Number.isFinite(port)) {
        callback(new Error("Invalid TLS connector options"), null);
        return;
      }

      const rejectUnauthorized = !allowSelfSigned;

      let settled = false;
      const finishError = (err: Error): void => {
        if (settled) return;
        settled = true;
        callback(err, null);
      };
      const finishSuccess = (socket: import("node:tls").TLSSocket): void => {
        if (settled) return;
        settled = true;
        callback(null, socket);
      };

      const socket = tls.connect({
        host: hostname,
        port,
        servername,
        rejectUnauthorized,
      }) as import("node:tls").TLSSocket;

      socket.unref();

      socket.once("error", (err: Error) => {
        finishError(err);
      });

      socket.once("secureConnect", () => {
        try {
          const cert = socket.getPeerCertificate();
          const identityErr = tls.checkServerIdentity(servername, cert);
          if (identityErr) throw identityErr;

          const actualRaw = typeof cert.fingerprint256 === "string" ? cert.fingerprint256 : "";
          const actual = normalizeFingerprint256(actualRaw);
          if (!actual) {
            throw new Error("TLS peer certificate missing fingerprint256.");
          }
          if (actual !== expectedFingerprint256) {
            throw new Error(
              `TLS certificate fingerprint mismatch (expected ${pinRaw}, got ${actualRaw}).`,
            );
          }

          finishSuccess(socket);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          socket.destroy(error);
          finishError(error);
        }
      });
    },
  });

  pinnedGatewayFetchState = {
    key,
    fetchImpl: undici.fetch as unknown as typeof fetch,
    dispatcher: agent,
  };

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

let startPromise: Promise<void> | null = null;
let embeddedGatewayAccessToken: string | null = null;

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
  const dbPath = config.embedded.dbPath || join(tyrumHome, "gateway.db");
  const gatewayBin = resolveGatewayBinPath();

  const starter = mgr.start({
    gatewayBin,
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
      embeddedGatewayAccessToken = null;
      return { status: "stopped" };
    });

    ipcMain.handle("gateway:status", async () => {
      const config = loadConfig();
      const mgr = manager;
      return getGatewayStatusSnapshot(mgr?.status, config.embedded.port);
    });

    ipcMain.handle("gateway:operator-connection", async () => {
      if (!configExists()) {
        throw new Error("Desktop is not configured yet. Choose Embedded or Remote mode first.");
      }

      const config = loadConfig();
      if (config.mode === "embedded") {
        const mgr = manager;
        if (!mgr) {
          throw new Error("Gateway IPC is not initialized");
        }
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
      const httpBaseUrl = resolveOperatorHttpBaseUrl(config);
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

      const rawInit =
        input.init && typeof input.init === "object" && !Array.isArray(input.init)
          ? (input.init as Record<string, unknown>)
          : undefined;

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

      const init: RequestInit = {
        method,
        headers: requestHeaders,
        body,
        redirect: "manual",
      };

      // The renderer always provides serializable primitives; ensure we pass plain objects through.
      const pinned =
        requestUrl.protocol === "https:" ? await resolvePinnedGatewayFetchState(config) : null;
      const res = pinned
        ? await pinned.fetchImpl(requestUrl.toString(), {
            ...(init as any),
            dispatcher: pinned.dispatcher,
          } as any)
        : await fetch(requestUrl.toString(), init);
      const bodyText = await res.text();
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return {
        status: res.status,
        headers: responseHeaders,
        bodyText,
      };
    });
  }

  return manager;
}
