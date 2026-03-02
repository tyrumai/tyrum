import type { OperatorCore } from "@tyrum/operator-core";
import { useState, type ComponentType } from "react";
import {
  Database,
  LayoutGrid,
  Link2,
  Monitor,
  Play,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
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
import { ToastProvider } from "./components/toast/toast-provider.js";
import { ThemeProvider, useThemeOptional } from "./hooks/use-theme.js";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
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
  | "pairing"
  | "admin"
  | "settings"
  | "desktop";

type NavIcon = ComponentType<{ className?: string }>;

const NAV_ITEM_CONFIG: Record<OperatorUiRouteId, { label: string; icon: NavIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutGrid },
  memory: { label: "Memory", icon: Database },
  approvals: { label: "Approvals", icon: ShieldCheck },
  runs: { label: "Runs", icon: Play },
  pairing: { label: "Pairing", icon: Link2 },
  admin: { label: "Admin", icon: Shield },
  settings: { label: "Settings", icon: SlidersHorizontal },
  desktop: { label: "Desktop", icon: Monitor },
};

const SIDEBAR_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "memory",
  "approvals",
  "runs",
  "pairing",
  "admin",
  "settings",
];

const MOBILE_NAV_ORDER: OperatorUiRouteId[] = ["dashboard", "approvals", "runs", "settings"];
const MOBILE_OVERFLOW_NAV_ORDER: OperatorUiRouteId[] = ["memory", "pairing", "admin"];
const DESKTOP_NAV_ORDER: OperatorUiRouteId[] = ["desktop"];

const KEYBOARD_NAV_ORDER: OperatorUiRouteId[] = [
  "dashboard",
  "memory",
  "approvals",
  "runs",
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
      <OperatorUiAppRoot core={core} mode={mode} onReconfigureGateway={onReconfigureGateway} />
    </ErrorBoundary>
  );
}

function OperatorUiAppRoot({
  core,
  mode,
  onReconfigureGateway,
}: Pick<OperatorUiAppProps, "core" | "mode" | "onReconfigureGateway">) {
  const [route, setRoute] = useState<OperatorUiRouteId>("dashboard");
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const existingTheme = useThemeOptional();

  const toNavItem = (id: OperatorUiRouteId) => ({
    id,
    label: NAV_ITEM_CONFIG[id].label,
    icon: NAV_ITEM_CONFIG[id].icon,
    testId: `nav-${id}`,
  });

  const sidebarItems = SIDEBAR_NAV_ORDER.map(toNavItem);
  const desktopItems = mode === "desktop" ? DESKTOP_NAV_ORDER.map(toNavItem) : [];
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
    isConnected
      ? KEYBOARD_NAV_ORDER.map((id, index) => ({
          key: String(index + 1),
          requireCmdOrCtrl: true,
          handler: () => {
            navigate(id);
          },
        }))
      : [],
  );

  const app = (
    <ToastProvider>
      <AppShell
        mode={mode}
        sidebar={
          isConnected ? (
            <Sidebar
              items={sidebarItems}
              secondaryItems={desktopItems}
              activeItemId={route}
              onNavigate={navigate}
              connectionStatus={connection.status}
            />
          ) : null
        }
        mobileNav={
          isConnected ? (
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
          {!isConnected ? (
            <div className="mx-auto mt-20 max-w-md w-full px-4">
              <ConnectPage core={core} mode={mode} onReconfigureGateway={onReconfigureGateway} />
            </div>
          ) : (
            <>
              {route === "dashboard" && <DashboardPage core={core} onNavigate={navigate} />}
              {route === "memory" && <MemoryPage core={core} />}
              {route === "approvals" && <ApprovalsPage core={core} />}
              {route === "runs" && <RunsPage core={core} />}
              {route === "pairing" && <PairingPage core={core} />}
              {route === "admin" && <AdminPage core={core} />}
              {route === "settings" && <SettingsPage core={core} mode={mode} />}
              {route === "desktop" && mode === "desktop" && <DesktopPage core={core} />}
            </>
          )}
        </AdminModeProvider>
      </AppShell>
    </ToastProvider>
  );
  return existingTheme ? app : <ThemeProvider>{app}</ThemeProvider>;
}
