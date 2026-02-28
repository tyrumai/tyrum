import type { ReactNode } from "react";
import {
  AppShell,
  Sidebar,
  type SidebarConnectionStatus,
  type SidebarNavItem,
} from "@tyrum/operator-ui";
import {
  BrainCircuit,
  Cable,
  CheckSquare,
  LayoutDashboard,
  Link2,
  Play,
  Settings,
  Shield,
  SquareKanban,
  Wrench,
} from "lucide-react";

interface LayoutProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  connectionStatus?: SidebarConnectionStatus;
  children: ReactNode;
}

const PRIMARY_NAV: SidebarNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "approvals", label: "Approvals", icon: CheckSquare },
  { id: "runs", label: "Runs", icon: Play },
  { id: "work", label: "Work", icon: SquareKanban },
  { id: "memory", label: "Memory", icon: BrainCircuit },
];

const SETUP_NAV: SidebarNavItem[] = [
  { id: "connection", label: "Connection", icon: Cable },
  { id: "pairing", label: "Pairing", icon: Link2 },
  { id: "permissions", label: "Permissions", icon: Shield },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "debug", label: "Debug", icon: Wrench },
];

export function Layout({
  currentPage,
  onNavigate,
  connectionStatus = "disconnected",
  children,
}: LayoutProps) {
  return (
    <AppShell
      mode="desktop"
      sidebar={
        <Sidebar
          items={PRIMARY_NAV}
          secondaryItems={SETUP_NAV}
          secondaryLabel="Setup"
          secondaryCollapsible
          collapsible
          showHeader={false}
          activeItemId={currentPage}
          onNavigate={onNavigate}
          connectionStatus={connectionStatus}
        />
      }
      mobileNav={null}
    >
      {children}
    </AppShell>
  );
}
