import React from "react";
import { createRoot } from "react-dom/client";
import {
  createElevatedModeStore,
  createBearerTokenAuth,
  createDeviceIdentity,
  createOperatorCore,
  createOperatorCoreManager,
  createTyrumHttpClient,
  httpAuthForAuth,
} from "@tyrum/operator-core/browser";
import {
  createAdminAccessController,
  OperatorUiApp,
  OperatorUiHostProvider,
  type AdminAccessController,
  type WebAuthPersistence,
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { reloadPage } from "./reload-page.js";
import { readAuthTokenFromUrl, stripAuthTokenFromUrl } from "./url-auth.js";

const GATEWAY_HTTP_STORAGE_KEY = "tyrum-gateway-http";
const GATEWAY_WS_STORAGE_KEY = "tyrum-gateway-ws";
const OPERATOR_TOKEN_STORAGE_KEY = "tyrum-operator-token";

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
  const resolvedAuth = resolveAuthFromLocation();
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
    saveToken(token) {
      storeOperatorToken(token);
      reloadPage();
    },
    clearToken() {
      clearStoredOperatorToken();
      reloadPage();
    },
  };

  const root = createRoot(rootContainer);
  const render = (): void => {
    root.render(
      <React.StrictMode>
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
