import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useThemeOptional, type ThemeMode } from "../../hooks/use-theme.js";
import { cn } from "../../lib/cn.js";
import { StatusDot } from "../ui/status-dot.js";

export type SidebarConnectionStatus = "disconnected" | "connecting" | "connected";

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
  connectionStatus?: SidebarConnectionStatus;
}

function nextThemeMode(current: ThemeMode): ThemeMode {
  if (current === "dark") return "light";
  if (current === "light") return "system";
  return "dark";
}

export function Sidebar({
  items,
  activeItemId,
  onNavigate,
  secondaryItems,
  secondaryLabel = "Desktop",
  connectionStatus = "disconnected",
  className,
  ...props
}: SidebarProps) {
  const theme = useThemeOptional();

  const dotVariant =
    connectionStatus === "connected"
      ? "success"
      : connectionStatus === "connecting"
        ? "primary"
        : "danger";
  const dotPulse = connectionStatus === "connecting";

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
        className={cn(
          "flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-3 py-2 text-sm transition-colors",
          "text-fg-muted hover:bg-bg-card hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          active ? "border-primary bg-primary-dim text-fg font-medium" : null,
        )}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </button>
    );
  };

  const canToggleTheme = Boolean(theme);
  const ThemeIcon = theme?.mode === "light" ? Sun : Moon;

  return (
    <aside
      className={cn(
        "flex h-screen w-60 shrink-0 flex-col border-r border-border bg-bg-subtle",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <div className="text-base font-semibold">Tyrum</div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
        {items.map(renderItem)}
        {secondaryItems && secondaryItems.length > 0 ? (
          <>
            <div className="mt-4 px-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
              {secondaryLabel}
            </div>
            {secondaryItems.map(renderItem)}
          </>
        ) : null}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <StatusDot
            data-testid="connection-status-dot"
            variant={dotVariant}
            pulse={dotPulse}
            aria-hidden="true"
          />
          <span>Connection</span>
        </div>

        {canToggleTheme ? (
          <button
            type="button"
            data-testid="theme-toggle"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              "text-fg-muted hover:bg-bg-card hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            )}
            onClick={() => {
              theme?.setMode(nextThemeMode(theme.mode));
            }}
          >
            <ThemeIcon className="h-4 w-4" />
            <span>Theme</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}

