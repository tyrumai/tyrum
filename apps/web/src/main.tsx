import React from "react";
import { createRoot } from "react-dom/client";
import {
  createElevatedModeStore,
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createGatewayAuthSession,
  createOperatorCoreManager,
} from "@tyrum/operator-core";
import { OperatorUiApp, OperatorUiHostProvider } from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { readAuthTokenFromUrl, stripAuthTokenFromUrl } from "./url-auth.js";

function scrubAuthTokenFromUrl(): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const stripped = stripAuthTokenFromUrl(window.location.href);
  if (stripped === current) return;
  window.history.replaceState(window.history.state, "", stripped);
}

function resolveGatewayHttpBaseUrl(): string {
  try {
    const stored = localStorage.getItem("tyrum-gateway-http");
    if (stored) return stored;
  } catch {}
  const override = import.meta.env.VITE_GATEWAY_HTTP_BASE_URL?.trim();
  if (override) return override;
  return window.location.origin;
}

function resolveAuthFromLocation(
  httpBaseUrl: string,
): ReturnType<typeof createBearerTokenAuth | typeof createBrowserCookieAuth> {
  const token = readAuthTokenFromUrl(window.location.href);
  scrubAuthTokenFromUrl();
  if (token) {
    void createGatewayAuthSession({ token, httpBaseUrl }).catch(() => {});
    return createBearerTokenAuth(token);
  }
  return createBrowserCookieAuth();
}

function resolveGatewayWsUrl(): string {
  try {
    const stored = localStorage.getItem("tyrum-gateway-ws");
    if (stored) return stored;
  } catch {}
  const override = import.meta.env.VITE_GATEWAY_WS_URL?.trim();
  if (override) return override;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element (#root).");
}

const elevatedModeStore = createElevatedModeStore();
const httpBaseUrl = resolveGatewayHttpBaseUrl();
const manager = createOperatorCoreManager({
  wsUrl: resolveGatewayWsUrl(),
  httpBaseUrl,
  baselineAuth: resolveAuthFromLocation(httpBaseUrl),
  elevatedModeStore,
});

const root = createRoot(container);
const render = (): void => {
  root.render(
    <React.StrictMode>
      <OperatorUiHostProvider value={{ kind: "web" }}>
        <OperatorUiApp
          core={manager.getCore()}
          mode="web"
          onReloadPage={() => window.location.reload()}
          onReconfigureGateway={(httpUrl, wsUrl) => {
            try {
              localStorage.setItem("tyrum-gateway-http", httpUrl);
              localStorage.setItem("tyrum-gateway-ws", wsUrl);
            } catch {}
            window.location.reload();
          }}
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
