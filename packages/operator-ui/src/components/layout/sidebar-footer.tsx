import * as React from "react";
import { ChevronsLeft, ChevronsRight, RefreshCw } from "lucide-react";
import { getConnectionDisplay, type ConnectionStatus } from "../../lib/connection-display.js";
import { cn } from "../../lib/cn.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";

const SIDEBAR_EXPANDED_ROW_LAYOUT =
  "box-border grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2";

function SidebarFooterRowContent({
  collapsed,
  icon,
  children,
}: {
  collapsed: boolean;
  icon: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed ? (
        <span className="min-w-0 flex-1 break-words leading-5 [overflow-wrap:anywhere]">
          {children}
        </span>
      ) : null}
    </>
  );
}

function SidebarSyncNowButton({
  collapsed,
  onSyncNow,
  syncNowDisabled,
  syncNowLoading,
}: {
  collapsed: boolean;
  onSyncNow: () => void;
  syncNowDisabled: boolean;
  syncNowLoading: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="sidebar-sync-now"
      title={syncNowLoading ? "Syncing..." : syncNowDisabled ? "Connect to sync." : "Sync now"}
      aria-label={syncNowLoading ? "Syncing" : "Sync now"}
      disabled={syncNowDisabled || syncNowLoading}
      className={cn(
        "flex w-full items-center rounded-md text-sm transition-colors",
        collapsed
          ? "justify-center px-1.5 py-1.5"
          : `${SIDEBAR_EXPANDED_ROW_LAYOUT} px-2.5 py-1.5 text-left`,
        syncNowDisabled || syncNowLoading
          ? "cursor-not-allowed opacity-50"
          : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
      )}
      onClick={() => {
        onSyncNow();
      }}
    >
      <SidebarFooterRowContent
        collapsed={collapsed}
        icon={<RefreshCw className={cn("h-4 w-4", syncNowLoading ? "animate-spin" : null)} />}
      >
        {syncNowLoading ? "Syncing…" : "Sync now"}
      </SidebarFooterRowContent>
    </button>
  );
}

function SidebarStatusControls({
  collapsed,
  connectionStatus,
  onConnectionClick,
}: {
  collapsed: boolean;
  connectionStatus: ConnectionStatus;
  onConnectionClick?: () => void;
}) {
  const connectionDisplay = getConnectionDisplay(connectionStatus);
  const interactive = onConnectionClick !== undefined;
  const content = (
    <SidebarFooterRowContent
      collapsed={collapsed}
      icon={
        <StatusDot
          data-testid="connection-status-dot"
          variant={connectionDisplay.variant}
          pulse={connectionDisplay.pulse}
          role="img"
          aria-label={`Connection ${connectionDisplay.label}`}
        />
      }
    >
      <span data-testid="connection-status-label">{connectionDisplay.label}</span>
    </SidebarFooterRowContent>
  );

  return (
    <div
      data-testid="sidebar-status-controls"
      className={cn("flex items-center", collapsed ? "justify-center" : "justify-start")}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {interactive ? (
              <button
                type="button"
                data-testid="sidebar-connection-status"
                className={cn(
                  "inline-flex w-full items-center rounded-md text-sm text-fg-muted transition-colors",
                  collapsed
                    ? "justify-center px-1.5 py-1.5"
                    : `${SIDEBAR_EXPANDED_ROW_LAYOUT} px-2.5 py-1.5 text-left`,
                  "hover:bg-bg-subtle hover:text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                )}
                onClick={onConnectionClick}
              >
                {content}
              </button>
            ) : (
              <span
                data-testid="sidebar-connection-status"
                className={cn(
                  "inline-flex w-full items-center rounded-md text-sm text-fg-muted",
                  collapsed
                    ? "justify-center px-1.5 py-1.5"
                    : `${SIDEBAR_EXPANDED_ROW_LAYOUT} px-2.5 py-1.5 text-left`,
                )}
              >
                {content}
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>
            {connectionDisplay.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function SidebarCollapseToggle({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="sidebar-collapse-toggle"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className={cn(
        "flex w-full items-center rounded-md text-sm transition-colors",
        collapsed
          ? "justify-center px-1.5 py-1.5"
          : `${SIDEBAR_EXPANDED_ROW_LAYOUT} px-2.5 py-1.5 text-left`,
        "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
      )}
      onClick={onToggleCollapsed}
    >
      <SidebarFooterRowContent
        collapsed={collapsed}
        icon={
          collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />
        }
      >
        Collapse
      </SidebarFooterRowContent>
    </button>
  );
}

export function SidebarFooter({
  collapsed,
  collapsible,
  connectionStatus,
  onConnectionClick,
  onSyncNow,
  syncNowDisabled,
  syncNowLoading,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  collapsible: boolean;
  connectionStatus: ConnectionStatus;
  onConnectionClick?: () => void;
  onSyncNow?: () => void;
  syncNowDisabled: boolean;
  syncNowLoading: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={cn(
        "mt-auto flex shrink-0 flex-col gap-1.5 border-t border-border",
        collapsed ? "p-2" : "p-3",
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

      <SidebarStatusControls
        collapsed={collapsed}
        connectionStatus={connectionStatus}
        onConnectionClick={onConnectionClick}
      />

      {collapsible ? (
        <SidebarCollapseToggle collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      ) : null}
    </div>
  );
}
