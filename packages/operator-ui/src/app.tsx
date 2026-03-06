import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Bot,
  Cable,
  Globe,
  LayoutGrid,
  Link2,
  Lock,
  MessageSquare,
  Monitor,
  SquareKanban,
  Shield,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { ElevatedModeProvider } from "./elevated-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar, type SidebarNavItem } from "./components/layout/sidebar.js";
import { ApprovalsPage } from "./components/pages/approvals-page.js";
import { AgentsPage } from "./components/pages/agents-page.js";
import { ChatPage } from "./components/pages/chat-page.js";
import { ConnectPage } from "./components/pages/connect-page.js";
import { ConfigurePage } from "./components/pages/configure-page.js";
import { DashboardPage } from "./components/pages/dashboard-page.js";
import { DesktopPage } from "./components/pages/desktop-page.js";
import { PairingPage } from "./components/pages/pairing-page.js";
import { WorkBoardPage } from "./components/pages/workboard-page.js";
import { BrowserCapabilitiesPage } from "./components/pages/platform/browser-capabilities-page.js";
import { PlatformConnectionPage } from "./components/pages/platform/connection-page.js";
import { PlatformDebugPage } from "./components/pages/platform/debug-page.js";
import { PlatformPermissionsPage } from "./components/pages/platform/permissions-page.js";
import { ToastProvider } from "./components/toast/toast-provider.js";
import { ThemeProvider, useThemeOptional } from "./hooks/use-theme.js";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
import { BrowserNodeProvider } from "./browser-node/browser-node-provider.js";
import { getDesktopApi } from "./desktop-api.js";
import { OperatorUiHostProvider, useHostApiOptional, type HostKind } from "./host/host-api.js";
import {
  getActiveAgentIdsFromSessionLanes,
  parseAgentIdFromKey,
} from "./lib/status-session-lanes.js";
import { useOperatorStore } from "./use-operator-store.js";
import type { ElevatedModeController } from "./components/elevated-mode/elevated-mode-controller.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  elevatedModeController?: ElevatedModeController;
  onReloadPage?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
}

type OperatorUiRouteId =
  | "dashboard"
  | "chat"
  | "approvals"
  | "workboard"
  | "agents"
  | "pairing"
  | "configure"
  | "desktop"
  | "connection"
  | "permissions"
  | "debug"
  | "browser";

type NavIcon = ComponentType<{ className?: string }>;

const NAV_ITEM_CONFIG: Record<OperatorUiRouteId, { label: string; icon: NavIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutGrid },
  chat: { label: "Chat", icon: MessageSquare },
  approvals: { label: "Approvals", icon: ShieldCheck },
  workboard: { label: "Work", icon: SquareKanban },
  agents: { label: "Agents", icon: Bot },
  pairing: { label: "Pairings", icon: Link2 },
  configure: { label: "Configure", icon: Shield },
  desktop: { label: "Desktop", icon: Monitor },
  connection: { label: "Connection", icon: Cable },
  permissions: { label: "Permissions", icon: Lock },
  debug: { label: "Debug", icon: Wrench },
  browser: { label: "Browser", icon: Globe },
};
const SIDEBAR_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "chat",
  "approvals",
  "workboard",
  "agents",
  "pairing",
  "configure",
];

const MOBILE_NAV_ORDER: OperatorUiRouteId[] = ["dashboard", "chat", "approvals", "workboard"];
const MOBILE_OVERFLOW_NAV_ORDER: OperatorUiRouteId[] = ["agents", "pairing", "configure"];
const PLATFORM_DESKTOP_NAV_ORDER: OperatorUiRouteId[] = [
  "desktop",
  "connection",
  "permissions",
  "debug",
];
const PLATFORM_WEB_NAV_ORDER: OperatorUiRouteId[] = ["browser"];

const KEYBOARD_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "chat",
  "approvals",
  "workboard",
  "agents",
  "pairing",
  "configure",
];

function isOperatorUiRouteId(value: string): value is OperatorUiRouteId {
  return Object.prototype.hasOwnProperty.call(NAV_ITEM_CONFIG, value);
}

export function OperatorUiApp({
  core,
  mode,
  elevatedModeController,
  onReloadPage,
  onReconfigureGateway,
}: OperatorUiAppProps) {
  return (
    <ErrorBoundary onReloadPage={onReloadPage}>
      <OperatorUiAppHostBoundary mode={mode}>
        <OperatorUiAppRoot
          core={core}
          mode={mode}
          elevatedModeController={elevatedModeController}
          onReconfigureGateway={onReconfigureGateway}
        />
      </OperatorUiAppHostBoundary>
    </ErrorBoundary>
  );
}

function OperatorUiAppHostBoundary({
  mode,
  children,
}: {
  mode: OperatorUiMode;
  children: ReactNode;
}) {
  const existing = useHostApiOptional();
  if (existing) return children;
  const value =
    mode === "desktop"
      ? { kind: "desktop" as const, api: getDesktopApi() }
      : { kind: "web" as const };
  return <OperatorUiHostProvider value={value}>{children}</OperatorUiHostProvider>;
}

function OperatorUiAppRoot({
  core,
  mode,
  elevatedModeController,
  onReconfigureGateway,
}: Pick<OperatorUiAppProps, "core" | "mode" | "elevatedModeController" | "onReconfigureGateway">) {
  const [route, setRoute] = useState<OperatorUiRouteId>("dashboard");
  const connection = useOperatorStore(core.connectionStore);
  const autoSync = useOperatorStore(core.autoSyncStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const runs = useOperatorStore(core.runsStore);
  const status = useOperatorStore(core.statusStore);
  const showOperatorRoutes =
    connection.status === "connected" ||
    (connection.status === "connecting" && connection.recovering);
  const showShell = mode === "desktop" || showOperatorRoutes;
  const existingTheme = useThemeOptional();
  const host = useHostApiOptional();
  const hostKind: HostKind = host?.kind ?? (mode === "desktop" ? "desktop" : "web");

  const activeAgentIds = new Set<string>();
  for (const run of Object.values(runs.runsById)) {
    if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") continue;
    const agentId = parseAgentIdFromKey(run.key);
    if (!agentId) continue;
    activeAgentIds.add(agentId);
  }
  for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
    activeAgentIds.add(agentId);
  }
  const activeAgentsCount = activeAgentIds.size;

  const toNavItem = (id: OperatorUiRouteId): SidebarNavItem => ({
    id,
    label: NAV_ITEM_CONFIG[id].label,
    icon: NAV_ITEM_CONFIG[id].icon,
    testId: `nav-${id}`,
    badgeCount:
      id === "approvals" && approvals.pendingIds.length > 0
        ? approvals.pendingIds.length
        : id === "pairing" && pairing.pendingIds.length > 0
          ? pairing.pendingIds.length
          : id === "agents" && activeAgentsCount > 0
            ? activeAgentsCount
            : undefined,
    badgeVariant:
      id === "approvals" && approvals.pendingIds.length > 0
        ? "danger"
        : id === "pairing" && pairing.pendingIds.length > 0
          ? "danger"
          : undefined,
  });

  const platformOrder =
    hostKind === "desktop" ? PLATFORM_DESKTOP_NAV_ORDER : PLATFORM_WEB_NAV_ORDER;
  const platformItems = platformOrder.map(toNavItem);
  const sidebarItems =
    mode === "desktop" && !showOperatorRoutes ? [] : SIDEBAR_NAV_ORDER.map(toNavItem);
  const mobileItems = MOBILE_NAV_ORDER.map(toNavItem);
  const mobileOverflowItems = MOBILE_OVERFLOW_NAV_ORDER.map(toNavItem);

  const navigate = (id: string): void => {
    if (!isOperatorUiRouteId(id)) return;
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        setRoute(id);
      });
      return;
    }
    setRoute(id);
  };

  useEffect(() => {
    if (host?.kind !== "desktop" || !host.api?.onNavigationRequest) {
      return;
    }

    return host.api.onNavigationRequest((request: unknown) => {
      if (!request || typeof request !== "object" || Array.isArray(request)) return;
      const pageId = (request as { pageId?: unknown }).pageId;
      if (typeof pageId !== "string") return;
      navigate(pageId);
    });
  }, [host]);

  useKeyboardShortcut(
    showOperatorRoutes
      ? KEYBOARD_NAV_ORDER.map((id, index) => ({
          key: String(index + 1),
          requireCmdOrCtrl: true,
          handler: () => {
            navigate(id);
          },
        }))
      : [],
  );

  const isPlatformRoute = platformOrder.includes(route);
  const showConnectPage =
    mode === "web" ? !showOperatorRoutes : !showOperatorRoutes && !isPlatformRoute;

  const shell = (
    <ElevatedModeProvider core={core} mode={mode} elevatedModeController={elevatedModeController}>
      <AppShell
        mode={mode}
        viewportLocked={route === "chat"}
        sidebar={
          showShell ? (
            <Sidebar
              items={sidebarItems}
              secondaryItems={platformItems}
              secondaryLabel="Platform"
              activeItemId={route}
              onNavigate={navigate}
              connectionStatus={connection.status}
              onSyncNow={() => {
                void core.syncAllNow();
              }}
              syncNowDisabled={connection.status !== "connected"}
              syncNowLoading={autoSync.isSyncing}
            />
          ) : null
        }
        mobileNav={
          showShell ? (
            <MobileNav
              items={mobileItems}
              overflowItems={mobileOverflowItems}
              activeItemId={route}
              onNavigate={navigate}
            />
          ) : null
        }
      >
        {showConnectPage ? (
          <div className="mx-auto mt-20 max-w-md w-full px-4">
            <ConnectPage core={core} mode={mode} onReconfigureGateway={onReconfigureGateway} />
          </div>
        ) : (
          <>
            {route === "dashboard" && <DashboardPage core={core} onNavigate={navigate} />}
            {route === "chat" && <ChatPage core={core} />}
            {route === "approvals" && <ApprovalsPage core={core} />}
            {route === "agents" && <AgentsPage core={core} />}
            {route === "workboard" && <WorkBoardPage core={core} />}
            {route === "pairing" && <PairingPage core={core} />}
            {route === "configure" && <ConfigurePage core={core} />}
            {route === "desktop" && mode === "desktop" && <DesktopPage core={core} />}
            {route === "connection" && <PlatformConnectionPage core={core} />}
            {route === "permissions" && <PlatformPermissionsPage />}
            {route === "debug" && <PlatformDebugPage />}
            {route === "browser" && hostKind === "web" && <BrowserCapabilitiesPage />}
          </>
        )}
      </AppShell>
    </ElevatedModeProvider>
  );

  const app = (
    <ToastProvider>
      {hostKind === "web" ? (
        <BrowserNodeProvider wsUrl={core.wsUrl}>{shell}</BrowserNodeProvider>
      ) : (
        shell
      )}
    </ToastProvider>
  );

  return existingTheme ? app : <ThemeProvider>{app}</ThemeProvider>;
}
