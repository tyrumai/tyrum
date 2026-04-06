import React, { Suspense } from "react";
import type { OperatorCore } from "../../operator-app/src/index.js";
import {
  AdminAccessModeProvider,
  AdminAccessProvider,
  AppShell,
  LocaleProvider,
  OperatorUiHostProvider,
  ScrollArea,
  ThemeProvider,
  ToastProvider,
} from "../src/index.js";
import { CONNECT_PAGE_RENDER, getOperatorRouteDefinition } from "../src/operator-routes.js";
import { RetainedUiStateProvider } from "../src/reconnect-ui-state.js";

export type OperatorUiA11yRouteId =
  | "connect"
  | "dashboard"
  | "chat"
  | "approvals"
  | "agents"
  | "pairing"
  | "desktop-environments"
  | "configure"
  | "desktop"
  | "browser";

export async function preloadOperatorUiRouteModules(route: OperatorUiA11yRouteId): Promise<void> {
  if (route === "connect") {
    return;
  }

  const modules: Promise<unknown>[] = [import("../src/components/pages/dashboard-page.js")];
  switch (route) {
    case "dashboard":
      break;
    case "chat":
      modules.push(import("../src/components/pages/chat-page-ai-sdk.js"));
      break;
    case "approvals":
      modules.push(import("../src/components/pages/approvals-page.js"));
      break;
    case "agents":
      modules.push(import("../src/components/pages/agents-page.js"));
      break;
    case "pairing":
      modules.push(import("../src/components/pages/pairing-page.js"));
      break;
    case "configure":
      modules.push(import("../src/components/pages/configure-page.js"));
      break;
    case "desktop":
    case "browser":
      modules.push(import("../src/components/pages/node-config/node-config-page.js"));
      break;
    case "desktop-environments":
      modules.push(import("../src/components/pages/desktop-environments-page.js"));
      break;
    default:
      route satisfies never;
  }
  await Promise.all(modules);
}

export function renderOperatorUiA11yRoute({
  core,
  mode,
  route,
}: {
  core: OperatorCore;
  mode: "web" | "desktop";
  route: OperatorUiA11yRouteId;
}) {
  const routeContext = {
    core,
    mode,
    hostKind: mode === "desktop" ? ("desktop" as const) : ("web" as const),
    navigate: () => {},
    openAgentActivity: () => {},
    agentsNavigationIntent: null,
    clearAgentsNavigationIntent: () => {},
    onboardingAvailable: false,
    onOpenOnboarding: undefined,
    onReconfigureGateway: undefined,
    onReloadPage: () => {},
    webAuthPersistence: undefined,
    initialConfigureTab: undefined,
    onConfigureTabChange: undefined,
  };

  const routeNode =
    route === "connect"
      ? CONNECT_PAGE_RENDER(routeContext)
      : getOperatorRouteDefinition(route)?.render(routeContext);

  const routeContent =
    route === "connect"
      ? React.createElement(
          "div",
          { className: "flex min-h-0 flex-1 overflow-hidden" },
          React.createElement(
            ScrollArea,
            { className: "h-full w-full" },
            React.createElement(
              "div",
              {
                className:
                  "mx-auto flex min-h-full w-full max-w-lg items-start px-4 py-6 md:items-center md:py-10",
              },
              React.createElement(Suspense, { fallback: null }, routeNode),
            ),
          ),
        )
      : React.createElement(Suspense, { fallback: null }, routeNode);

  return React.createElement(
    OperatorUiHostProvider,
    { value: { kind: "desktop", api: null } },
    React.createElement(
      LocaleProvider,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            AppShell,
            { mode, sidebar: null, mobileNav: null },
            React.createElement(
              RetainedUiStateProvider,
              { scopeKey: `a11y:${mode}:${route}` },
              React.createElement(
                AdminAccessModeProvider,
                null,
                React.createElement(AdminAccessProvider, { core, mode }, routeContent),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export async function settleOperatorUiWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}
