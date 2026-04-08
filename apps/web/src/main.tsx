import React from "react";
import { createRoot } from "react-dom/client";
import {
  createElevatedModeStore,
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createGatewayAuthCookie,
  clearGatewayAuthCookie,
  createOperatorCore,
  createOperatorCoreManager,
  httpAuthForAuth,
} from "@tyrum/operator-app";
import {
  createDeviceIdentity,
  createTyrumHttpClient,
  formatDeviceIdentityError,
} from "@tyrum/operator-app/browser";
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
  const token = resolvedAuth.auth.type === "bearer-token" ? resolvedAuth.auth.token.trim() : "";
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
const root = createRoot(rootContainer);

type BootstrapFatalState = {
  title: string;
  description: string;
  details?: string;
};

function renderBootstrapFatal(state: BootstrapFatalState): void {
  root.render(
    <React.StrictMode>
      <div className="min-h-screen bg-bg text-fg">
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
          <section className="w-full rounded-2xl border border-border bg-bg-card p-8 shadow-sm">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <div className="text-sm font-medium uppercase tracking-[0.14em] text-fg-muted">
                  Operator UI Bootstrap Failed
                </div>
                <h1 className="text-2xl font-semibold text-fg">{state.title}</h1>
                <p className="text-sm leading-6 text-fg-muted">{state.description}</p>
              </div>
              {state.details ? (
                <div className="rounded-lg border border-border bg-bg-subtle/40 p-4 text-sm text-fg-muted">
                  {state.details}
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </React.StrictMode>,
  );
}

function isPotentiallyTrustworthyOrigin(): boolean {
  const protocol = window.location.protocol.toLowerCase();
  if (protocol === "https:") {
    return true;
  }
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function hasBrowserBootstrapPrerequisites(): boolean {
  const secureContext = window.isSecureContext || isPotentiallyTrustworthyOrigin();
  return secureContext && typeof globalThis.crypto?.subtle !== "undefined";
}

function resolveBootstrapFatalState(error: unknown): BootstrapFatalState {
  if (!hasBrowserBootstrapPrerequisites()) {
    return {
      title: "A secure browser context is required",
      description:
        "Remote browser clients must load the Tyrum UI over HTTPS/WSS so the browser can create a device identity and expose secure browser-node capabilities such as geolocation.",
      details:
        "Open this deployment via https://.../ui (or localhost for local development). Plain HTTP on a remote host is not supported for browser-node pairing or location access.",
    };
  }

  return {
    title: "The operator UI could not finish bootstrapping",
    description: "A fatal startup error prevented the web operator from connecting to the gateway.",
    details: formatDeviceIdentityError(error),
  };
}

async function bootstrap(): Promise<void> {
  if (!hasBrowserBootstrapPrerequisites()) {
    renderBootstrapFatal(resolveBootstrapFatalState(null));
    return;
  }

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

try {
  await bootstrap();
} catch (error) {
  renderBootstrapFatal(resolveBootstrapFatalState(error));
}
