import React from "react";
import { createRoot } from "react-dom/client";
import {
  createAdminModeStore,
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCoreManager,
} from "@tyrum/operator-core";
import { OperatorUiApp } from "@tyrum/operator-ui";
import { readAuthTokenFromUrl, stripAuthTokenFromUrl } from "./url-auth.js";

function scrubAuthTokenFromUrl(): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const stripped = stripAuthTokenFromUrl(window.location.href);
  if (stripped === current) return;
  window.history.replaceState(window.history.state, "", stripped);
}

function resolveAuthFromLocation(): ReturnType<
  typeof createBearerTokenAuth | typeof createBrowserCookieAuth
> {
  const token = readAuthTokenFromUrl(window.location.href);
  scrubAuthTokenFromUrl();
  if (token) return createBearerTokenAuth(token);
  return createBrowserCookieAuth();
}

function resolveGatewayHttpBaseUrl(): string {
  const override = import.meta.env.VITE_GATEWAY_HTTP_BASE_URL?.trim();
  if (override) return override;
  return window.location.origin;
}

function resolveGatewayWsUrl(): string {
  const override = import.meta.env.VITE_GATEWAY_WS_URL?.trim();
  if (override) return override;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element (#root).");
}

const adminModeStore = createAdminModeStore();
const manager = createOperatorCoreManager({
  wsUrl: resolveGatewayWsUrl(),
  httpBaseUrl: resolveGatewayHttpBaseUrl(),
  baselineAuth: resolveAuthFromLocation(),
  adminModeStore,
});

const root = createRoot(container);
const render = (): void => {
  root.render(
    <React.StrictMode>
      <OperatorUiApp core={manager.getCore()} mode="web" />
    </React.StrictMode>,
  );
};

const unsubscribe = manager.subscribe(() => {
  render();
});

window.addEventListener("beforeunload", () => {
  unsubscribe();
  manager.dispose();
  adminModeStore.dispose();
});

render();
