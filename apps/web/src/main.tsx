import React from "react";
import { createRoot } from "react-dom/client";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "@tyrum/operator-core";
import { OperatorUiApp } from "@tyrum/operator-ui";

function resolveAuthFromLocation(): ReturnType<
  typeof createBearerTokenAuth | typeof createBrowserCookieAuth
> {
  const token = new URLSearchParams(window.location.search).get("token")?.trim();
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

const core = createOperatorCore({
  wsUrl: resolveGatewayWsUrl(),
  httpBaseUrl: resolveGatewayHttpBaseUrl(),
  auth: resolveAuthFromLocation(),
});

window.addEventListener("beforeunload", () => {
  core.dispose();
});

createRoot(container).render(
  <React.StrictMode>
    <OperatorUiApp core={core} mode="web" />
  </React.StrictMode>,
);
