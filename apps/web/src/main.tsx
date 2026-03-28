import React from "react";
import { createRoot } from "react-dom/client";
import {
  createElevatedModeStore,
  createBearerTokenAuth,
  createGatewayAuthCookie,
  clearGatewayAuthCookie,
  createOperatorCore,
  createOperatorCoreManager,
  httpAuthForAuth,
} from "@tyrum/operator-app";
import { createDeviceIdentity, createTyrumHttpClient } from "@tyrum/operator-app/browser";
import {
  createAdminAccessController,
  LocaleProvider,
  OperatorUiApp,
  OperatorUiHostProvider,
  type AdminAccessController,
  type WebAuthPersistence,
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { BrowserNodeProvider } from "./browser-node/browser-node-provider.js";
import { reloadPage } from "./reload-page.js";
import { readAuthTokenFromUrl, stripAuthTokenFromUrl } from "./url-auth.js";

const GATEWAY_HTTP_STORAGE_KEY = "tyrum-gateway-http";
const GATEWAY_WS_STORAGE_KEY = "tyrum-gateway-ws";
const OPERATOR_TOKEN_STORAGE_KEY = "tyrum-operator-token";

type ResolvedWebAuth = {
  auth: ReturnType<typeof createBearerTokenAuth> | ReturnType<typeof createBrowserCookieAuth>;
  connectOnLoad: boolean;
  hasStoredToken: boolean;
};

function scrubAuthTokenFromUrl(): void {
  window.history.replaceState(
    window.history.state,
    "",
    stripAuthTokenFromUrl(window.location.href),
  );
}

function resolveGatewayHttpBaseUrl(): string {
  try {
    const stored = localStorage.getItem(GATEWAY_HTTP_STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  const override = import.meta.env.VITE_GATEWAY_HTTP_BASE_URL?.trim();
  if (override) return override;
  return window.location.origin;
}

function readStoredOperatorToken(): string | null {
  try {
    const stored = localStorage.getItem(OPERATOR_TOKEN_STORAGE_KEY)?.trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

function storeOperatorToken(token: string): void {
  localStorage.setItem(OPERATOR_TOKEN_STORAGE_KEY, token);
}

function clearStoredOperatorToken(): void {
  localStorage.removeItem(OPERATOR_TOKEN_STORAGE_KEY);
}

function resolveAuthFromLocation(): {
  auth: ReturnType<typeof createBearerTokenAuth>;
  connectOnLoad: boolean;
  hasStoredToken: boolean;
} {
  const tokenFromUrl = readAuthTokenFromUrl(window.location.href);
  if (tokenFromUrl) {
    let hasStoredToken = false;
    try {
      storeOperatorToken(tokenFromUrl);
      hasStoredToken = true;
    } catch {}
    scrubAuthTokenFromUrl();
    return {
      auth: createBearerTokenAuth(tokenFromUrl),
      connectOnLoad: true,
      hasStoredToken,
    };
  }

  const storedToken = readStoredOperatorToken();
  return {
    auth: createBearerTokenAuth(storedToken ?? ""),
    connectOnLoad: storedToken !== null,
    hasStoredToken: storedToken !== null,
  };
}

async function readResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as {
        error?: unknown;
        message?: unknown;
      };
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (message) return message;
    } else {
      const text = (await response.text()).trim();
      if (text) return text;
    }
  } catch {
    // Intentional: fall back to a deterministic status-based message.
  }
  return fallback;
}

async function ensureGatewayBrowserConversation(params: {
  token: string;
  httpBaseUrl: string;
}): Promise<void> {
  const response = await createGatewayAuthCookie({
    token: params.token,
    httpBaseUrl: params.httpBaseUrl,
    credentials: "include",
  });
  if (response.status === 204) {
    return;
  }

  throw new Error(
    await readResponseErrorMessage(
      response,
      `Failed to create a browser auth cookie (HTTP ${String(response.status)}).`,
    ),
  );
}

async function ensureGatewayBrowserLogout(httpBaseUrl: string): Promise<void> {
  const response = await clearGatewayAuthCookie({
    httpBaseUrl,
    credentials: "include",
  });
  if (response.status === 204) {
    return;
  }

  throw new Error(
    await readResponseErrorMessage(
      response,
      `Failed to clear the browser auth cookie (HTTP ${String(response.status)}).`,
    ),
  );
}

async function syncGatewayBrowserConversationOnBootstrap(params: {
  token: string;
  httpBaseUrl: string;
}): Promise<"ok" | "unauthorized" | "fallback"> {
  try {
    const response = await createGatewayAuthCookie({
      token: params.token,
      httpBaseUrl: params.httpBaseUrl,
      credentials: "include",
    });
    if (response.status === 204) {
      return "ok";
    }
    if (response.status === 401 || response.status === 403) {
      return "unauthorized";
    }
  } catch {
    // Intentional: preserve bearer-token bootstrap when conversation sync fails transiently.
  }

  return "fallback";
}

async function resolveWebAuth(httpBaseUrl: string): Promise<ResolvedWebAuth> {
  const resolvedAuth = resolveAuthFromLocation();
  const token = resolvedAuth.auth.token.trim();
  if (!token) {
    return resolvedAuth;
  }

  const syncResult = await syncGatewayBrowserConversationOnBootstrap({
    token,
    httpBaseUrl,
  });
  if (syncResult !== "unauthorized") {
    return resolvedAuth;
  }

  try {
    clearStoredOperatorToken();
  } catch {
    // Intentional: browser storage may be unavailable; still drop back to the connect screen.
  }

  return {
    auth: createBearerTokenAuth(""),
    connectOnLoad: false,
    hasStoredToken: false,
  };
}

async function bestEffortClearGatewayBrowserConversation(httpBaseUrl: string): Promise<void> {
  try {
    await ensureGatewayBrowserLogout(httpBaseUrl);
  } catch {
    // Intentional: avoid masking the original local persistence failure.
  }
}

async function bestEffortRestoreGatewayBrowserConversation(params: {
  token: string;
  httpBaseUrl: string;
}): Promise<void> {
  try {
    await ensureGatewayBrowserConversation(params);
  } catch {
    // Intentional: avoid masking the original local persistence failure.
  }
}

function resolveGatewayWsUrl(): string {
  try {
    const stored = localStorage.getItem(GATEWAY_WS_STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  const override = import.meta.env.VITE_GATEWAY_WS_URL?.trim();
  if (override) return override;

  return `${window.location.origin.replace(/^http/, "ws")}/ws`;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element (#root).");
}
const rootContainer = container;

async function bootstrap(): Promise<void> {
  const deviceIdentity = await createDeviceIdentity();
  const elevatedModeStore = createElevatedModeStore();
  const httpBaseUrl = resolveGatewayHttpBaseUrl();
  const resolvedAuth = await resolveWebAuth(httpBaseUrl);
  const baselineHttp = createTyrumHttpClient({
    baseUrl: httpBaseUrl,
    auth: httpAuthForAuth(resolvedAuth.auth),
  });
  const manager = createOperatorCoreManager({
    wsUrl: resolveGatewayWsUrl(),
    httpBaseUrl,
    baselineAuth: resolvedAuth.auth,
    elevatedModeStore,
    createCore(coreOptions) {
      return createOperatorCore({
        ...coreOptions,
        deviceIdentity,
      });
    },
  });
  const adminAccessController: AdminAccessController = createAdminAccessController({
    http: baselineHttp,
    deviceId: deviceIdentity.deviceId,
    elevatedModeStore,
  });

  if (resolvedAuth.connectOnLoad) {
    manager.getCore().connect();
  }

  const webAuthPersistence: WebAuthPersistence = {
    hasStoredToken: resolvedAuth.hasStoredToken,
    readToken() {
      return readStoredOperatorToken();
    },
    async saveToken(token) {
      await ensureGatewayBrowserConversation({ token, httpBaseUrl });
      try {
        storeOperatorToken(token);
      } catch (error) {
        await bestEffortClearGatewayBrowserConversation(httpBaseUrl);
        throw error;
      }
      reloadPage();
    },
    async clearToken() {
      const savedToken = readStoredOperatorToken();
      await ensureGatewayBrowserLogout(httpBaseUrl);
      try {
        clearStoredOperatorToken();
      } catch (error) {
        if (savedToken) {
          await bestEffortRestoreGatewayBrowserConversation({
            token: savedToken,
            httpBaseUrl,
          });
        }
        throw error;
      }
      reloadPage();
    },
  };

  const root = createRoot(rootContainer);
  const render = (): void => {
    root.render(
      <React.StrictMode>
        <LocaleProvider>
          <BrowserNodeProvider wsUrl={resolveGatewayWsUrl()}>
            <OperatorUiHostProvider value={{ kind: "web" }}>
              <OperatorUiApp
                core={manager.getCore()}
                mode="web"
                adminAccessController={adminAccessController}
                onReloadPage={reloadPage}
                onReconfigureGateway={(httpUrl, wsUrl) => {
                  try {
                    localStorage.setItem(GATEWAY_HTTP_STORAGE_KEY, httpUrl);
                    localStorage.setItem(GATEWAY_WS_STORAGE_KEY, wsUrl);
                  } catch {}
                  reloadPage();
                }}
                webAuthPersistence={webAuthPersistence}
              />
            </OperatorUiHostProvider>
          </BrowserNodeProvider>
        </LocaleProvider>
      </React.StrictMode>,
    );
  };

  const unsubscribe = manager.subscribe(() => {
    render();
  });

  window.addEventListener("beforeunload", () => {
    unsubscribe();
    manager.dispose();
    elevatedModeStore.dispose();
  });

  render();
}

await bootstrap();
