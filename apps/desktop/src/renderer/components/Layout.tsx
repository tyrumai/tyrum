import type { ReactNode } from "react";
import { AppShell, Sidebar, type SidebarNavItem } from "@tyrum/operator-ui";

interface LayoutProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  fullBleed?: boolean;
  children: ReactNode;
}

const NullIcon = () => null;

const NAV_ITEMS: SidebarNavItem[] = [
  { id: "overview", label: "Overview", icon: NullIcon },
  { id: "gateway", label: "Gateway", icon: NullIcon },
  { id: "connection", label: "Connection", icon: NullIcon },
  { id: "permissions", label: "Permissions", icon: NullIcon },
  { id: "diagnostics", label: "Diagnostics", icon: NullIcon },
  { id: "logs", label: "Logs", icon: NullIcon },
];

export function Layout({ currentPage, onNavigate, fullBleed = false, children }: LayoutProps) {
  return (
    <AppShell
      mode="desktop"
      fullBleed={fullBleed}
      sidebar={<Sidebar items={NAV_ITEMS} activeItemId={currentPage} onNavigate={onNavigate} />}
      mobileNav={null}
    >
      {children}
    </AppShell>
  );
}
