import React from "react";
import { AppShell } from "../../../packages/operator-ui/src/components/layout/app-shell.js";
import { Sidebar } from "../../../packages/operator-ui/src/components/layout/sidebar.js";
import { AgentsPage } from "../../../packages/operator-ui/src/components/pages/agents-page.js";
import { ApprovalsPage } from "../../../packages/operator-ui/src/components/pages/approvals-page.js";
import { AiSdkChatPage } from "../../../packages/operator-ui/src/components/pages/chat-page-ai-sdk.js";
import { ConfigurePage } from "../../../packages/operator-ui/src/components/pages/configure-page.js";
import { DashboardPage } from "../../../packages/operator-ui/src/components/pages/dashboard-page.js";
import { ExtensionsPage } from "../../../packages/operator-ui/src/components/pages/extensions-page.js";
import { FirstRunOnboardingPage } from "../../../packages/operator-ui/src/components/pages/first-run-onboarding.js";
import { NodeConfigPage } from "../../../packages/operator-ui/src/components/pages/node-config/node-config-page.js";
import { PairingPage } from "../../../packages/operator-ui/src/components/pages/pairing-page.js";
import { WorkBoardPage } from "../../../packages/operator-ui/src/components/pages/workboard-page.js";
import { AdminAccessProvider } from "../../../packages/operator-ui/src/elevated-mode.js";
import { OperatorUiHostProvider } from "../../../packages/operator-ui/src/host/host-api.js";
import { BrowserNodeProvider } from "./browser-node/browser-node-provider.js";
import {
  createAgentsCore,
  createApprovalsCore,
  createChatCore,
  createConfigureCore,
  createDashboardCore,
  createDesktopApi,
  createOnboardingDesktopApi,
  createOnboardingCore,
  createPairingCore,
  createWorkboardCore,
} from "./layout-harness-route-fixtures.js";

type LayoutRoute =
  | "dashboard"
  | "chat"
  | "approvals"
  | "agents"
  | "pairing"
  | "workboard"
  | "extensions"
  | "configure"
  | "browser"
  | "desktop"
  | "onboarding";

function HarnessIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 8h6" />
      <path d="M8 5v6" />
    </svg>
  );
}

function createBrowserRoute(): React.ReactNode {
  return (
    <BrowserNodeProvider wsUrl="ws://127.0.0.1:8788/ws">
      <OperatorUiHostProvider value={{ kind: "web" }}>
        <NodeConfigPage />
      </OperatorUiHostProvider>
    </BrowserNodeProvider>
  );
}

function createDesktopRoute(): React.ReactNode {
  return (
    <OperatorUiHostProvider value={{ kind: "desktop", api: createDesktopApi() }}>
      <NodeConfigPage />
    </OperatorUiHostProvider>
  );
}

function createOnboardingRoute(): React.ReactNode {
  const core = createOnboardingCore();
  const desktopApi = createOnboardingDesktopApi();
  (window as typeof window & { tyrumDesktop?: unknown }).tyrumDesktop = desktopApi;
  return (
    <OperatorUiHostProvider value={{ kind: "desktop", api: desktopApi }}>
      <AdminAccessProvider core={core} mode="desktop">
        <FirstRunOnboardingPage
          core={core}
          onClose={() => undefined}
          onSkip={() => undefined}
          onMarkCompleted={() => undefined}
          onNavigate={() => undefined}
        />
      </AdminAccessProvider>
    </OperatorUiHostProvider>
  );
}

function renderRoute(route: LayoutRoute): React.ReactNode {
  switch (route) {
    case "dashboard":
      return <DashboardPage core={createDashboardCore()} />;
    case "chat":
      return <AiSdkChatPage core={createChatCore()} />;
    case "approvals": {
      const core = createApprovalsCore();
      return (
        <AdminAccessProvider core={core} mode="desktop">
          <ApprovalsPage core={core} />
        </AdminAccessProvider>
      );
    }
    case "agents":
      return <AgentsPage core={createAgentsCore()} />;
    case "pairing": {
      const core = createPairingCore();
      return (
        <AdminAccessProvider core={core} mode="desktop">
          <PairingPage core={core} />
        </AdminAccessProvider>
      );
    }
    case "workboard":
      return <WorkBoardPage core={createWorkboardCore()} />;
    case "extensions": {
      const core = createAgentsCore();
      return (
        <AdminAccessProvider core={core} mode="desktop">
          <ExtensionsPage core={core} />
        </AdminAccessProvider>
      );
    }
    case "configure": {
      const core = createConfigureCore();
      return (
        <AdminAccessProvider core={core} mode="desktop">
          <ConfigurePage core={core} />
        </AdminAccessProvider>
      );
    }
    case "browser":
      return createBrowserRoute();
    case "desktop":
      return createDesktopRoute();
    case "onboarding":
      return createOnboardingRoute();
    default:
      return null;
  }
}

export function LayoutHarnessApp() {
  const params = new URLSearchParams(window.location.search);
  const route = (params.get("route") ?? "dashboard") as LayoutRoute;
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: HarnessIcon },
    { id: "chat", label: "Chat", icon: HarnessIcon },
    { id: "approvals", label: "Approvals", icon: HarnessIcon },
    { id: "agents", label: "Agents", icon: HarnessIcon },
    { id: "pairing", label: "Nodes", icon: HarnessIcon },
    { id: "workboard", label: "Work", icon: HarnessIcon },
    { id: "extensions", label: "Extensions", icon: HarnessIcon },
    { id: "configure", label: "Configure", icon: HarnessIcon },
    { id: "browser", label: "Browser", icon: HarnessIcon },
    { id: "desktop", label: "Desktop", icon: HarnessIcon },
    { id: "onboarding", label: "Onboarding", icon: HarnessIcon },
  ];
  const secondaryNavItems = [{ id: "node-browser", label: "Browser", icon: HarnessIcon }];

  return (
    <AppShell
      mode="desktop"
      fullBleed={true}
      viewportLocked={true}
      sidebar={
        <Sidebar
          items={navItems}
          secondaryItems={secondaryNavItems}
          secondaryLabel="Node"
          activeItemId={route}
          onNavigate={() => undefined}
          collapsible
          connectionStatus="connected"
          onSyncNow={() => undefined}
          syncNowDisabled={false}
          syncNowLoading={false}
        />
      }
      mobileNav={null}
    >
      {renderRoute(route)}
    </AppShell>
  );
}
