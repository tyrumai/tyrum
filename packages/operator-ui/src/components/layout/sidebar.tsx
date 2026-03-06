import * as React from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, RefreshCw } from "lucide-react";
import { getConnectionDisplay, type ConnectionStatus } from "../../lib/connection-display.js";
import { cn } from "../../lib/cn.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";

export type SidebarConnectionStatus = ConnectionStatus;

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
  badgeCount?: number;
  badgeVariant?: BadgeVariant;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  items: SidebarNavItem[];
  activeItemId: string;
  onNavigate: (id: string) => void;
  secondaryItems?: SidebarNavItem[];
  secondaryLabel?: string;
  secondaryCollapsible?: boolean;
  secondaryDefaultCollapsed?: boolean;
  collapsible?: boolean;
  showHeader?: boolean;
  connectionStatus?: SidebarConnectionStatus;
  onSyncNow?: () => void;
  syncNowDisabled?: boolean;
  syncNowLoading?: boolean;
}

const STORAGE_KEY_SECONDARY = "tyrum-sidebar-secondary-collapsed";
const STORAGE_KEY_SIDEBAR = "tyrum-sidebar-collapsed";

function readStoredBool(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // localStorage unavailable
  }
  return defaultValue;
}

function writeStoredBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage unavailable
  }
}

interface SidebarNavButtonProps {
  item: SidebarNavItem;
  activeItemId: string;
  collapsed: boolean;
  onNavigate: (id: string) => void;
}

function SidebarNavButton({ item, activeItemId, collapsed, onNavigate }: SidebarNavButtonProps) {
  const Icon = item.icon;
  const active = item.id === activeItemId;
  const badgeCount = item.badgeCount ?? 0;
  const badgeText = badgeCount > 99 ? "99+" : String(badgeCount);

  return (
    <button
      type="button"
      data-testid={item.testId ?? `nav-${item.id}`}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex w-full items-center rounded-md text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
        "border-l-2 border-transparent",
        active
          ? "border-primary bg-primary-dim text-fg font-medium"
          : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={() => {
        onNavigate(item.id);
      }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {badgeCount > 0 ? (
            <Badge variant={item.badgeVariant ?? "default"} className="ml-auto">
              {badgeText}
            </Badge>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

interface SidebarHeaderProps {
  collapsed: boolean;
  showHeader: boolean;
}

function SidebarHeader({ collapsed, showHeader }: SidebarHeaderProps) {
  if (!showHeader || collapsed) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-4">
      <div className="text-base font-semibold">Tyrum</div>
    </div>
  );
}

interface SidebarNavProps {
  items: SidebarNavItem[];
  activeItemId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  secondaryItems?: SidebarNavItem[];
  secondaryLabel: string;
  secondaryCollapsible: boolean;
  secondaryCollapsed: boolean;
  onToggleSecondary: () => void;
}

function SidebarNav({
  items,
  activeItemId,
  onNavigate,
  collapsed,
  secondaryItems,
  secondaryLabel,
  secondaryCollapsible,
  secondaryCollapsed,
  onToggleSecondary,
}: SidebarNavProps) {
  const showSecondaryItems = secondaryItems && secondaryItems.length > 0;
  const secondaryVisible = showSecondaryItems && (!secondaryCollapsible || !secondaryCollapsed);

  const renderNavItem = (item: SidebarNavItem) => (
    <SidebarNavButton
      key={item.id}
      item={item}
      activeItemId={activeItemId}
      collapsed={collapsed}
      onNavigate={onNavigate}
    />
  );

  return (
    <nav className={cn("flex flex-1 flex-col gap-1 py-3", collapsed ? "px-1" : "px-2")}>
      {items.map(renderNavItem)}
      {showSecondaryItems ? (
        <>
          <div className="mt-4 border-t border-border" />
          {secondaryCollapsible && !collapsed ? (
            <button
              type="button"
              data-testid="sidebar-secondary-toggle"
              className="mt-3 flex w-full items-center gap-1 rounded-md px-3 py-1 text-xs font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
              onClick={onToggleSecondary}
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  secondaryCollapsed ? "-rotate-90" : null,
                )}
              />
              <span>{secondaryLabel}</span>
            </button>
          ) : !collapsed ? (
            <div className="mt-3 px-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
              {secondaryLabel}
            </div>
          ) : null}
          {collapsed || secondaryVisible ? secondaryItems.map(renderNavItem) : null}
        </>
      ) : null}
    </nav>
  );
}

interface SidebarSyncNowButtonProps {
  collapsed: boolean;
  onSyncNow: () => void;
  syncNowDisabled: boolean;
  syncNowLoading: boolean;
}

function SidebarSyncNowButton({
  collapsed,
  onSyncNow,
  syncNowDisabled,
  syncNowLoading,
}: SidebarSyncNowButtonProps) {
  return (
    <button
      type="button"
      data-testid="sidebar-sync-now"
      title={syncNowLoading ? "Syncing..." : syncNowDisabled ? "Connect to sync." : "Sync now"}
      aria-label={syncNowLoading ? "Syncing" : "Sync now"}
      disabled={syncNowDisabled || syncNowLoading}
      className={cn(
        "flex items-center rounded-md text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
        syncNowDisabled || syncNowLoading
          ? "cursor-not-allowed opacity-50"
          : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={() => {
        onSyncNow();
      }}
    >
      <RefreshCw className={cn("h-4 w-4", syncNowLoading ? "animate-spin" : null)} />
      {!collapsed ? <span>{syncNowLoading ? "Syncing…" : "Sync now"}</span> : null}
    </button>
  );
}

interface SidebarStatusControlsProps {
  collapsed: boolean;
  connectionStatus: SidebarConnectionStatus;
}

function SidebarStatusControls({ collapsed, connectionStatus }: SidebarStatusControlsProps) {
  const connectionDisplay = getConnectionDisplay(connectionStatus);

  return (
    <div
      data-testid="sidebar-status-controls"
      className={cn("flex items-center", collapsed ? "justify-center" : "justify-start")}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded-md text-sm text-fg-muted",
                collapsed ? "justify-center px-2 py-2" : "w-full gap-2 px-3 py-2",
              )}
            >
              <StatusDot
                data-testid="connection-status-dot"
                variant={connectionDisplay.variant}
                pulse={connectionDisplay.pulse}
                role="img"
                aria-label={`Connection ${connectionDisplay.label}`}
              />
              {!collapsed ? (
                <span data-testid="connection-status-label" className="truncate">
                  {connectionDisplay.label}
                </span>
              ) : null}
            </span>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>
            {connectionDisplay.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

interface SidebarCollapseToggleProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function SidebarCollapseToggle({ collapsed, onToggleCollapsed }: SidebarCollapseToggleProps) {
  return (
    <button
      type="button"
      data-testid="sidebar-collapse-toggle"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "flex items-center rounded-md text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
        "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={onToggleCollapsed}
    >
      {collapsed ? (
        <ChevronsRight className="h-4 w-4" />
      ) : (
        <>
          <ChevronsLeft className="h-4 w-4" />
          <span>Collapse</span>
        </>
      )}
    </button>
  );
}

interface SidebarFooterProps {
  collapsed: boolean;
  collapsible: boolean;
  connectionStatus: SidebarConnectionStatus;
  onSyncNow?: () => void;
  syncNowDisabled: boolean;
  syncNowLoading: boolean;
  onToggleCollapsed: () => void;
}

function SidebarFooter({
  collapsed,
  collapsible,
  connectionStatus,
  onSyncNow,
  syncNowDisabled,
  syncNowLoading,
  onToggleCollapsed,
}: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-col gap-2 border-t border-border",
        collapsed ? "p-2" : "p-4",
      )}
    >
      {onSyncNow ? (
        <SidebarSyncNowButton
          collapsed={collapsed}
          onSyncNow={onSyncNow}
          syncNowDisabled={syncNowDisabled}
          syncNowLoading={syncNowLoading}
        />
      ) : null}

      <SidebarStatusControls collapsed={collapsed} connectionStatus={connectionStatus} />

      {collapsible ? (
        <SidebarCollapseToggle collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      ) : null}
    </div>
  );
}

export function Sidebar({
  items,
  activeItemId,
  onNavigate,
  secondaryItems,
  secondaryLabel = "Node",
  secondaryCollapsible = false,
  secondaryDefaultCollapsed = true,
  collapsible = false,
  showHeader = true,
  connectionStatus = "disconnected",
  onSyncNow,
  syncNowDisabled = false,
  syncNowLoading = false,
  className,
  ...props
}: SidebarProps) {
  const [collapsed, setCollapsed] = React.useState(() =>
    collapsible ? readStoredBool(STORAGE_KEY_SIDEBAR, false) : false,
  );

  const [secondaryCollapsed, setSecondaryCollapsed] = React.useState(() =>
    secondaryCollapsible ? readStoredBool(STORAGE_KEY_SECONDARY, secondaryDefaultCollapsed) : false,
  );

  // Auto-expand when navigating TO a secondary item. We read the collapsed
  // state via a ref so the effect doesn't re-fire when the user manually
  // toggles the section (which would immediately undo their toggle).
  const secondaryCollapsedRef = React.useRef(secondaryCollapsed);
  secondaryCollapsedRef.current = secondaryCollapsed;

  React.useEffect(() => {
    if (!secondaryCollapsible || !secondaryItems) return;
    const isSecondaryActive = secondaryItems.some((item) => item.id === activeItemId);
    if (isSecondaryActive && secondaryCollapsedRef.current) {
      setSecondaryCollapsed(false);
      writeStoredBool(STORAGE_KEY_SECONDARY, false);
    }
  }, [activeItemId, secondaryCollapsible, secondaryItems]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStoredBool(STORAGE_KEY_SIDEBAR, next);
  };

  const toggleSecondary = () => {
    const next = !secondaryCollapsed;
    setSecondaryCollapsed(next);
    writeStoredBool(STORAGE_KEY_SECONDARY, next);
  };

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border bg-bg-subtle/80 backdrop-blur-2xl transition-[width] duration-200",
        collapsed ? "w-12" : "w-52",
        className,
      )}
      {...props}
    >
      <SidebarHeader collapsed={collapsed} showHeader={showHeader} />

      <SidebarNav
        items={items}
        activeItemId={activeItemId}
        onNavigate={onNavigate}
        collapsed={collapsed}
        secondaryItems={secondaryItems}
        secondaryLabel={secondaryLabel}
        secondaryCollapsible={secondaryCollapsible}
        secondaryCollapsed={secondaryCollapsed}
        onToggleSecondary={toggleSecondary}
      />

      <SidebarFooter
        collapsed={collapsed}
        collapsible={collapsible}
        connectionStatus={connectionStatus}
        onSyncNow={onSyncNow}
        syncNowDisabled={syncNowDisabled}
        syncNowLoading={syncNowLoading}
        onToggleCollapsed={toggleCollapsed}
      />
    </aside>
  );
}
