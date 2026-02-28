import type { OperatorCore } from "@tyrum/operator-core";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Database,
  LayoutDashboard,
  Link2,
  LogIn,
  Monitor,
  Play,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { AdminModeProvider } from "./admin-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar } from "./components/layout/sidebar.js";
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
}

type OperatorUiRouteId =
  | "connect"
  | "dashboard"
  | "memory"
  | "approvals"
  | "runs"
  | "pairing"
  | "settings"
  | "desktop";

type NavIcon = ComponentType<{ className?: string }>;

const NAV_ITEM_CONFIG: Record<OperatorUiRouteId, { label: string; icon: NavIcon }> = {
  connect: { label: "Connect", icon: LogIn },
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  memory: { label: "Memory", icon: Database },
  approvals: { label: "Approvals", icon: ShieldCheck },
  runs: { label: "Runs", icon: Play },
  pairing: { label: "Pairing", icon: Link2 },
  settings: { label: "Settings", icon: Settings },
  desktop: { label: "Desktop", icon: Monitor },
};

const SIDEBAR_NAV_ORDER: OperatorUiRouteId[] = [
  "connect",
  "dashboard",
  "memory",
  "approvals",
  "runs",
  "pairing",
  "settings",
];

const MOBILE_NAV_ORDER: OperatorUiRouteId[] = ["dashboard", "approvals", "runs", "settings"];
const MOBILE_OVERFLOW_NAV_ORDER: OperatorUiRouteId[] = ["memory", "pairing", "connect"];
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

function MaybeThemeProvider({ children }: { children: ReactNode }) {
  const existing = useThemeOptional();
  if (existing) {
    return <>{children}</>;
  }
  return <ThemeProvider>{children}</ThemeProvider>;
}

export function OperatorUiApp({ core, mode, onReloadPage }: OperatorUiAppProps) {
  return (
    <ErrorBoundary onReloadPage={onReloadPage}>
      <OperatorUiAppRoot core={core} mode={mode} />
    </ErrorBoundary>
  );
}

function OperatorUiAppRoot({ core, mode }: Pick<OperatorUiAppProps, "core" | "mode">) {
  const [route, setRoute] = useState<OperatorUiRouteId>("connect");
  const connection = useOperatorStore(core.connectionStore);

  const resolveLabel = (id: OperatorUiRouteId): string => {
    if (mode === "web" && id === "connect") return "Login";
    return NAV_ITEM_CONFIG[id].label;
  };

  const toNavItem = (id: OperatorUiRouteId) => ({
    id,
    label: resolveLabel(id),
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
    KEYBOARD_NAV_ORDER.map((id, index) => ({
      key: String(index + 1),
      requireCmdOrCtrl: true,
      handler: () => {
        navigate(id);
      },
    })),
  );

  return (
    <MaybeThemeProvider>
      <ToastProvider>
        <AppShell
          mode={mode}
          sidebar={
            <Sidebar
              items={sidebarItems}
              secondaryItems={desktopItems}
              activeItemId={route}
              onNavigate={navigate}
              connectionStatus={connection.status}
            />
          }
          mobileNav={
            <MobileNav
              items={mobileItems}
              overflowItems={mobileOverflowItems}
              activeItemId={route}
              onNavigate={navigate}
            />
          }
        >
          <AdminModeProvider core={core} mode={mode}>
            {route === "connect" && <ConnectPage core={core} mode={mode} />}
            {route === "dashboard" && <DashboardPage core={core} onNavigate={navigate} />}
            {route === "memory" && <MemoryPage core={core} />}
            {route === "approvals" && <ApprovalsPage core={core} />}
            {route === "runs" && <RunsPage core={core} />}
            {route === "pairing" && <PairingPage core={core} />}
            {route === "settings" && <SettingsPage core={core} mode={mode} />}
            {route === "desktop" && mode === "desktop" && <DesktopPage core={core} />}
          </AdminModeProvider>
        </AppShell>
      </ToastProvider>
    </MaybeThemeProvider>
  );
}
