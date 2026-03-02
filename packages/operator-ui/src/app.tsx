import type { OperatorCore } from "@tyrum/operator-core";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Cable,
  Database,
  Globe,
  LayoutGrid,
  Link2,
  Lock,
  Monitor,
  Play,
  SquareKanban,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { AdminModeProvider } from "./admin-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar } from "./components/layout/sidebar.js";
import { AdminPage } from "./components/pages/admin-page.js";
import { ApprovalsPage } from "./components/pages/approvals-page.js";
import { ConnectPage } from "./components/pages/connect-page.js";
import { DashboardPage } from "./components/pages/dashboard-page.js";
import { DesktopPage } from "./components/pages/desktop-page.js";
import { MemoryPage } from "./components/pages/memory-page.js";
import { PairingPage } from "./components/pages/pairing-page.js";
import { RunsPage } from "./components/pages/runs-page.js";
import { SettingsPage } from "./components/pages/settings-page.js";
import { WorkBoardPage } from "./components/pages/workboard-page.js";
import { BrowserCapabilitiesPage } from "./components/pages/platform/browser-capabilities-page.js";
import { PlatformConnectionPage } from "./components/pages/platform/connection-page.js";
import { PlatformDebugPage } from "./components/pages/platform/debug-page.js";
import { PlatformPermissionsPage } from "./components/pages/platform/permissions-page.js";
import { ToastProvider } from "./components/toast/toast-provider.js";
import { ThemeProvider, useThemeOptional } from "./hooks/use-theme.js";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
import { getDesktopApi } from "./desktop-api.js";
import { OperatorUiHostProvider, useHostApiOptional, type HostKind } from "./host/host-api.js";
import { useOperatorStore } from "./use-operator-store.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  onReloadPage?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
}

type OperatorUiRouteId =
  | "dashboard"
  | "memory"
  | "approvals"
  | "runs"
  | "workboard"
  | "pairing"
  | "admin"
  | "settings"
  | "desktop"
  | "connection"
  | "permissions"
  | "debug"
  | "browser";

type NavIcon = ComponentType<{ className?: string }>;

const NAV_ITEM_CONFIG: Record<OperatorUiRouteId, { label: string; icon: NavIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutGrid },
  memory: { label: "Memory", icon: Database },
  approvals: { label: "Approvals", icon: ShieldCheck },
  runs: { label: "Runs", icon: Play },
  workboard: { label: "Work", icon: SquareKanban },
  pairing: { label: "Pairing", icon: Link2 },
  admin: { label: "Admin", icon: Shield },
  settings: { label: "Settings", icon: SlidersHorizontal },
  desktop: { label: "Desktop", icon: Monitor },
  connection: { label: "Connection", icon: Cable },
  permissions: { label: "Permissions", icon: Lock },
  debug: { label: "Debug", icon: Wrench },
  browser: { label: "Browser", icon: Globe },
};
const SIDEBAR_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "memory",
  "approvals",
  "runs",
  "workboard",
  "pairing",
  "admin",
  "settings",
];

const MOBILE_NAV_ORDER: OperatorUiRouteId[] = ["dashboard", "approvals", "runs", "settings"];
const MOBILE_OVERFLOW_NAV_ORDER: OperatorUiRouteId[] = ["memory", "workboard", "pairing", "admin"];
const PLATFORM_DESKTOP_NAV_ORDER: OperatorUiRouteId[] = [
  "desktop",
  "connection",
  "permissions",
  "debug",
];
const PLATFORM_WEB_NAV_ORDER: OperatorUiRouteId[] = ["browser"];

const KEYBOARD_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "memory",
  "approvals",
  "runs",
  "workboard",
  "pairing",
  "settings",
];

function isOperatorUiRouteId(value: string): value is OperatorUiRouteId {
  return Object.prototype.hasOwnProperty.call(NAV_ITEM_CONFIG, value);
}

export function OperatorUiApp({
  core,
  mode,
  onReloadPage,
  onReconfigureGateway,
}: OperatorUiAppProps) {
  return (
    <ErrorBoundary onReloadPage={onReloadPage}>
      <OperatorUiAppHostBoundary mode={mode}>
        <OperatorUiAppRoot core={core} mode={mode} onReconfigureGateway={onReconfigureGateway} />
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
  onReconfigureGateway,
}: Pick<OperatorUiAppProps, "core" | "mode" | "onReconfigureGateway">) {
  const [route, setRoute] = useState<OperatorUiRouteId>("dashboard");
  const connection = useOperatorStore(core.connectionStore);
  const showOperatorRoutes =
    connection.status === "connected" ||
    (connection.status === "connecting" && connection.recovering);
  const showShell = mode === "desktop" || showOperatorRoutes;
  const existingTheme = useThemeOptional();
  const host = useHostApiOptional();
  const hostKind: HostKind = host?.kind ?? (mode === "desktop" ? "desktop" : "web");

  const toNavItem = (id: OperatorUiRouteId) => ({
    id,
    label: NAV_ITEM_CONFIG[id].label,
    icon: NAV_ITEM_CONFIG[id].icon,
    testId: `nav-${id}`,
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

  const app = (
    <ToastProvider>
      <AppShell
        mode={mode}
        sidebar={
          showShell ? (
            <Sidebar
              items={sidebarItems}
              secondaryItems={platformItems}
              secondaryLabel="Platform"
              activeItemId={route}
              onNavigate={navigate}
              connectionStatus={connection.status}
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
        <AdminModeProvider core={core} mode={mode}>
          {showConnectPage ? (
            <div className="mx-auto mt-20 max-w-md w-full px-4">
              <ConnectPage core={core} mode={mode} onReconfigureGateway={onReconfigureGateway} />
            </div>
          ) : (
            <>
              {route === "dashboard" && <DashboardPage core={core} onNavigate={navigate} />}
              {route === "memory" && <MemoryPage core={core} />}
              {route === "approvals" && <ApprovalsPage core={core} />}
              {route === "runs" && <RunsPage core={core} />}
              {route === "workboard" && <WorkBoardPage core={core} />}
              {route === "pairing" && <PairingPage core={core} />}
              {route === "admin" && <AdminPage core={core} />}
              {route === "settings" && <SettingsPage core={core} mode={mode} />}
              {route === "desktop" && mode === "desktop" && <DesktopPage core={core} />}
              {route === "connection" && <PlatformConnectionPage core={core} />}
              {route === "permissions" && <PlatformPermissionsPage />}
              {route === "debug" && <PlatformDebugPage />}
              {route === "browser" && <BrowserCapabilitiesPage />}
            </>
          )}
        </AdminModeProvider>
      </AppShell>
    </ToastProvider>
  );
  return existingTheme ? app : <ThemeProvider>{app}</ThemeProvider>;
}
