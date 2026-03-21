import * as React from "react";
import { ChevronDown } from "lucide-react";
import { type ConnectionStatus } from "../../lib/connection-display.js";
import { cn } from "../../lib/cn.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { SidebarFooter } from "./sidebar-footer.js";

export type SidebarConnectionStatus = ConnectionStatus;

export interface SidebarNavItem {
  id: string;
  label: string;
  mobileLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
  badgeCount?: number;
  badgeVariant?: BadgeVariant;
}

export interface SidebarItemGroup {
  id: string;
  label: string;
  items: SidebarNavItem[];
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  items: SidebarNavItem[];
  groups?: SidebarItemGroup[];
  activeItemId: string;
  onNavigate: (id: string) => void;
  onConnectionClick?: () => void;
  secondaryItems?: SidebarNavItem[];
  secondaryLabel?: string;
  secondaryCollapsible?: boolean;
  secondaryDefaultCollapsed?: boolean;
  collapsible?: boolean;
  connectionStatus?: SidebarConnectionStatus;
  onSyncNow?: () => void;
  syncNowDisabled?: boolean;
  syncNowLoading?: boolean;
}

const STORAGE_KEY_SECONDARY = "tyrum-sidebar-secondary-collapsed";
const STORAGE_KEY_SIDEBAR = "tyrum-sidebar-collapsed";
const SIDEBAR_EXPANDED_ROW_LAYOUT =
  "box-border grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2";

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

function SidebarNavButton({
  item,
  activeItemId,
  collapsed,
  onNavigate,
}: {
  item: SidebarNavItem;
  activeItemId: string;
  collapsed: boolean;
  onNavigate: (id: string) => void;
}) {
  const Icon = item.icon;
  const active = item.id === activeItemId;
  const badgeCount = item.badgeCount ?? 0;
  const badgeText = badgeCount > 99 ? "99+" : String(badgeCount);
  const button = (
    <button
      type="button"
      data-testid={item.testId ?? `nav-${item.id}`}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "relative flex w-full rounded-md border text-sm transition-colors duration-150",
        collapsed
          ? "justify-center border-transparent px-1.5 py-1.5"
          : `${SIDEBAR_EXPANDED_ROW_LAYOUT} border-transparent px-2.5 py-1.5 text-left`,
        active
          ? "border-border bg-bg text-fg font-medium"
          : "border-transparent text-fg-muted hover:border-border hover:bg-bg hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={() => {
        onNavigate(item.id);
      }}
    >
      {active ? (
        <span
          aria-hidden="true"
          data-testid={`${item.testId ?? `nav-${item.id}`}-active-indicator`}
          className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-primary"
        />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? (
        <>
          <span className="min-w-0 break-words leading-5 [overflow-wrap:anywhere]">
            {item.label}
          </span>
          {badgeCount > 0 ? (
            <Badge variant={item.badgeVariant ?? "default"} className="shrink-0 justify-self-end">
              {badgeText}
            </Badge>
          ) : null}
        </>
      ) : null}
    </button>
  );

  if (!collapsed) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarNav({
  items,
  groups,
  activeItemId,
  onNavigate,
  collapsed,
  secondaryItems,
  secondaryLabel,
  secondaryCollapsible,
  secondaryCollapsed,
  onToggleSecondary,
}: {
  items: SidebarNavItem[];
  groups?: SidebarItemGroup[];
  activeItemId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  secondaryItems?: SidebarNavItem[];
  secondaryLabel: string;
  secondaryCollapsible: boolean;
  secondaryCollapsed: boolean;
  onToggleSecondary: () => void;
}) {
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
    <TooltipProvider>
      <nav
        data-testid="sidebar-nav"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2",
          collapsed ? "px-1" : "px-2",
        )}
      >
        {groups && groups.length > 0
          ? groups.map((group, groupIndex) => (
              <React.Fragment key={group.id}>
                {groupIndex > 0 ? (
                  <div className="mt-3 border-t border-border" aria-hidden="true" />
                ) : null}
                {!collapsed ? (
                  <div
                    data-testid={`sidebar-section-${group.id}`}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted/70",
                      groupIndex > 0 ? "mt-1" : null,
                    )}
                  >
                    {group.label}
                  </div>
                ) : null}
                {group.items.map(renderNavItem)}
              </React.Fragment>
            ))
          : items.map(renderNavItem)}
        {showSecondaryItems ? (
          <>
            <div className="mt-4 border-t border-border" />
            {secondaryCollapsible && !collapsed ? (
              <button
                type="button"
                data-testid="sidebar-secondary-toggle"
                className={cn(
                  "mt-2 rounded-md py-1 text-left text-xs font-medium text-fg-muted hover:text-fg",
                  SIDEBAR_EXPANDED_ROW_LAYOUT,
                  "px-2.5",
                )}
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
              <div
                data-testid="sidebar-secondary-label"
                className={cn(
                  "mt-2 py-1 text-xs font-medium text-fg-muted",
                  SIDEBAR_EXPANDED_ROW_LAYOUT,
                  "px-2.5",
                )}
              >
                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>{secondaryLabel}</span>
              </div>
            ) : null}
            {collapsed || secondaryVisible ? secondaryItems.map(renderNavItem) : null}
          </>
        ) : null}
      </nav>
    </TooltipProvider>
  );
}

export function Sidebar({
  items,
  groups,
  activeItemId,
  onNavigate,
  secondaryItems,
  secondaryLabel = "This Device",
  secondaryCollapsible = false,
  secondaryDefaultCollapsed = true,
  collapsible = false,
  connectionStatus = "disconnected",
  onConnectionClick,
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
        "flex h-full shrink-0 flex-col border-r border-border bg-bg-subtle transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
        className,
      )}
      {...props}
    >
      <SidebarNav
        items={items}
        groups={groups}
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
        onConnectionClick={onConnectionClick}
        onSyncNow={onSyncNow}
        syncNowDisabled={syncNowDisabled}
        syncNowLoading={syncNowLoading}
        onToggleCollapsed={toggleCollapsed}
      />
    </aside>
  );
}
