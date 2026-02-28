import * as React from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, Moon, Sun } from "lucide-react";
import { useThemeOptional, type ThemeMode } from "../../hooks/use-theme.js";
import { getConnectionDisplay, type ConnectionStatus } from "../../lib/connection-display.js";
import { cn } from "../../lib/cn.js";
import { StatusDot } from "../ui/status-dot.js";

export type SidebarConnectionStatus = ConnectionStatus;

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
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
}

function nextThemeMode(current: ThemeMode): ThemeMode {
  if (current === "dark") return "light";
  if (current === "light") return "system";
  return "dark";
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

export function Sidebar({
  items,
  activeItemId,
  onNavigate,
  secondaryItems,
  secondaryLabel = "Desktop",
  secondaryCollapsible = false,
  secondaryDefaultCollapsed = true,
  collapsible = false,
  showHeader = true,
  connectionStatus = "disconnected",
  className,
  ...props
}: SidebarProps) {
  const theme = useThemeOptional();

  const [collapsed, setCollapsed] = React.useState(() =>
    collapsible ? readStoredBool(STORAGE_KEY_SIDEBAR, false) : false,
  );

  const [secondaryCollapsed, setSecondaryCollapsed] = React.useState(() =>
    secondaryCollapsible ? readStoredBool(STORAGE_KEY_SECONDARY, secondaryDefaultCollapsed) : false,
  );

  // Auto-expand when active item is in secondary section
  React.useEffect(() => {
    if (!secondaryCollapsible || !secondaryItems) return;
    const isSecondaryActive = secondaryItems.some((item) => item.id === activeItemId);
    if (isSecondaryActive && secondaryCollapsed) {
      setSecondaryCollapsed(false);
      writeStoredBool(STORAGE_KEY_SECONDARY, false);
    }
  }, [activeItemId, secondaryCollapsible, secondaryItems, secondaryCollapsed]);

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

  const connectionDisplay = getConnectionDisplay(connectionStatus);
  const dotVariant = connectionDisplay.variant;
  const dotPulse = connectionDisplay.pulse;
  const connectionLabel = connectionDisplay.label;

  const renderItem = (item: SidebarNavItem) => {
    const Icon = item.icon;
    const active = item.id === activeItemId;
    return (
      <button
        key={item.id}
        type="button"
        data-testid={item.testId ?? `nav-${item.id}`}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex w-full items-center rounded-md text-sm transition-colors",
          collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
          active
            ? "border-l-2 border-primary bg-primary-dim text-fg font-medium"
            : "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        )}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed ? <span>{item.label}</span> : null}
      </button>
    );
  };

  const canToggleTheme = Boolean(theme);
  const ThemeIcon = theme?.mode === "light" ? Sun : Moon;

  const showSecondaryItems = secondaryItems && secondaryItems.length > 0;
  const secondaryVisible = showSecondaryItems && (!secondaryCollapsible || !secondaryCollapsed);

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border bg-bg-subtle transition-[width] duration-200",
        collapsed ? "w-12" : "w-52",
        className,
      )}
      {...props}
    >
      {showHeader && !collapsed ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <div className="text-base font-semibold">Tyrum</div>
        </div>
      ) : null}

      <nav className={cn("flex flex-1 flex-col gap-1 py-3", collapsed ? "px-1" : "px-2")}>
        {items.map(renderItem)}
        {showSecondaryItems ? (
          <>
            {secondaryCollapsible && !collapsed ? (
              <button
                type="button"
                data-testid="sidebar-secondary-toggle"
                className="mt-4 flex w-full items-center gap-1 rounded-md px-3 py-1 text-xs font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
                onClick={toggleSecondary}
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
              <div className="mt-4 px-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                {secondaryLabel}
              </div>
            ) : (
              <div className="mt-4 border-t border-border" />
            )}
            {collapsed
              ? secondaryItems.map(renderItem)
              : secondaryVisible
                ? secondaryItems.map(renderItem)
                : null}
          </>
        ) : null}
      </nav>

      <div className={cn("mt-auto flex flex-col gap-2 border-t border-border", collapsed ? "p-2" : "p-4")}>
        {collapsed ? (
          <div className="flex justify-center" title={connectionLabel}>
            <StatusDot
              data-testid="connection-status-dot"
              variant={dotVariant}
              pulse={dotPulse}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
            <div className="flex items-center gap-2">
              <StatusDot
                data-testid="connection-status-dot"
                variant={dotVariant}
                pulse={dotPulse}
                aria-hidden="true"
              />
              <span>Connection</span>
            </div>
            <span>{connectionLabel}</span>
          </div>
        )}

        {canToggleTheme ? (
          <button
            type="button"
            data-testid="theme-toggle"
            title={collapsed ? "Theme" : undefined}
            className={cn(
              "flex items-center rounded-md text-sm transition-colors",
              collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
              "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            )}
            onClick={() => {
              theme?.setMode(nextThemeMode(theme.mode));
            }}
          >
            <ThemeIcon className="h-4 w-4" />
            {!collapsed ? <span>Theme</span> : null}
          </button>
        ) : null}

        {collapsible ? (
          <button
            type="button"
            data-testid="sidebar-collapse-toggle"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center rounded-md text-sm transition-colors",
              collapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
              "text-fg-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            )}
            onClick={toggleCollapsed}
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
        ) : null}
      </div>
    </aside>
  );
}
