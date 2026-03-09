import React from "react";
import {
  Bot,
  Globe,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Settings,
  ShieldCheck,
  SquareKanban,
  Wrench,
} from "lucide-react";
import { AppShell } from "../../../packages/operator-ui/src/components/layout/app-shell.js";
import { Sidebar } from "../../../packages/operator-ui/src/components/layout/sidebar.js";
import { AgentsPage } from "../../../packages/operator-ui/src/components/pages/agents-page.js";
import { ApprovalsPage } from "../../../packages/operator-ui/src/components/pages/approvals-page.js";
import { ChatPage } from "../../../packages/operator-ui/src/components/pages/chat-page.js";
import { ConfigurePage } from "../../../packages/operator-ui/src/components/pages/configure-page.js";
import { DashboardPage } from "../../../packages/operator-ui/src/components/pages/dashboard-page.js";
import { NodeConfigurePage } from "../../../packages/operator-ui/src/components/pages/node-configure-page.js";
import { PairingPage } from "../../../packages/operator-ui/src/components/pages/pairing-page.js";
import { BrowserCapabilitiesPage } from "../../../packages/operator-ui/src/components/pages/platform/browser-capabilities-page.js";
import { WorkBoardPage } from "../../../packages/operator-ui/src/components/pages/workboard-page.js";
import { BrowserNodeProvider } from "../../../packages/operator-ui/src/browser-node/browser-node-provider.js";
import { ElevatedModeProvider } from "../../../packages/operator-ui/src/elevated-mode.js";
import { OperatorUiHostProvider } from "../../../packages/operator-ui/src/host/host-api.js";
import {
  createAgentsCore,
  createApprovalsCore,
  createChatCore,
  createConfigureCore,
  createDashboardCore,
  createDesktopApi,
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
  | "configure"
  | "browser"
  | "node-configure";

function createBrowserRoute(): React.ReactNode {
  return (
    <BrowserNodeProvider wsUrl="ws://127.0.0.1:8788/ws">
      <BrowserCapabilitiesPage />
    </BrowserNodeProvider>
  );
}

function createNodeConfigureRoute(): React.ReactNode {
  return (
    <OperatorUiHostProvider value={{ kind: "desktop", api: createDesktopApi() }}>
      <NodeConfigurePage />
    </OperatorUiHostProvider>
  );
}

function renderRoute(route: LayoutRoute): React.ReactNode {
  switch (route) {
    case "dashboard":
      return <DashboardPage core={createDashboardCore()} />;
    case "chat":
      return <ChatPage core={createChatCore()} />;
    case "approvals":
      return <ApprovalsPage core={createApprovalsCore()} />;
    case "agents":
      return <AgentsPage core={createAgentsCore()} />;
    case "pairing":
      return <PairingPage core={createPairingCore()} />;
    case "workboard":
      return <WorkBoardPage core={createWorkboardCore()} />;
    case "configure": {
      const core = createConfigureCore();
      return (
        <ElevatedModeProvider core={core} mode="desktop">
          <ConfigurePage core={core} />
        </ElevatedModeProvider>
      );
    }
    case "browser":
      return createBrowserRoute();
    case "node-configure":
      return createNodeConfigureRoute();
    default:
      return null;
  }
}

export function LayoutHarnessApp() {
  const params = new URLSearchParams(window.location.search);
  const route = (params.get("route") ?? "dashboard") as LayoutRoute;
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "approvals", label: "Approvals", icon: ShieldCheck },
    { id: "agents", label: "Agents", icon: Bot },
    { id: "pairing", label: "Pairings", icon: Link2 },
    { id: "workboard", label: "Work", icon: SquareKanban },
    { id: "configure", label: "Configure", icon: Settings },
    { id: "browser", label: "Browser", icon: Globe },
    { id: "node-configure", label: "Node", icon: Wrench },
  ];

  return (
    <AppShell
      mode="desktop"
      fullBleed={true}
      viewportLocked={true}
      sidebar={
        <Sidebar
          items={navItems}
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
