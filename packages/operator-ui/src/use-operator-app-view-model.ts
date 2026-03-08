import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useState } from "react";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
import {
  getActiveAgentIdsFromSessionLanes,
  resolveAgentIdForRun,
} from "./lib/status-session-lanes.js";
import {
  getOperatorRouteDefinition,
  OPERATOR_ROUTE_DEFINITIONS,
  type OperatorUiRouteId,
} from "./operator-routes.js";
import type { HostKind } from "./host/host-api.js";
import type { SidebarNavItem } from "./components/layout/sidebar.js";
import { useOperatorStore } from "./use-operator-store.js";

const KEYBOARD_NAV_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

function isOperatorUiRouteId(value: string): value is OperatorUiRouteId {
  return OPERATOR_ROUTE_DEFINITIONS.some((route) => route.id === value);
}

export function useOperatorAppViewModel(opts: {
  core: OperatorCore;
  mode: "web" | "desktop";
  hostKind: HostKind;
  onNavigationRequest?: (handler: (request: unknown) => void) => (() => void) | undefined;
}) {
  const { core, mode, hostKind } = opts;
  const [route, setRoute] = useState<OperatorUiRouteId>("dashboard");
  const connection = useOperatorStore(core.connectionStore);
  const autoSync = useOperatorStore(core.autoSyncStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const runs = useOperatorStore(core.runsStore);
  const status = useOperatorStore(core.statusStore);
  const showOperatorRoutes =
    connection.status === "connected" ||
    (connection.status === "connecting" && connection.recovering);
  const showShell = mode === "desktop" || showOperatorRoutes;

  const activeAgentIds = new Set<string>();
  for (const run of Object.values(runs.runsById)) {
    if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") continue;
    const agentId = resolveAgentIdForRun(run, runs.agentKeyByRunId);
    if (!agentId) continue;
    activeAgentIds.add(agentId);
  }
  for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
    activeAgentIds.add(agentId);
  }
  const activeAgentsCount = activeAgentIds.size;

  const toNavItem = (routeId: OperatorUiRouteId): SidebarNavItem => {
    const definition = getOperatorRouteDefinition(routeId);
    if (!definition) {
      throw new Error(`Unknown operator route: ${routeId}`);
    }
    return {
      id: routeId,
      label: definition.label,
      icon: definition.icon,
      testId: `nav-${routeId}`,
      badgeCount:
        routeId === "approvals" && approvals.pendingIds.length > 0
          ? approvals.pendingIds.length
          : routeId === "pairing" && pairing.pendingIds.length > 0
            ? pairing.pendingIds.length
            : routeId === "agents" && activeAgentsCount > 0
              ? activeAgentsCount
              : undefined,
      badgeVariant: undefined,
    };
  };

  const availableRoutes = OPERATOR_ROUTE_DEFINITIONS.filter((item) =>
    item.hostKinds.includes(hostKind),
  );
  const sidebarItems = availableRoutes
    .filter((item) => item.navGroup === "sidebar")
    .map((item) => toNavItem(item.id));
  const mobileItems = sidebarItems.slice(0, 4);
  const mobileOverflowItems = sidebarItems.slice(4);
  const platformItems = availableRoutes
    .filter((item) =>
      hostKind === "desktop"
        ? item.navGroup === "platformDesktop"
        : item.navGroup === "platformWeb",
    )
    .map((item) => toNavItem(item.id));

  const navigate = (id: string): void => {
    if (!isOperatorUiRouteId(id)) return;
    const definition = getOperatorRouteDefinition(id);
    if (!definition || !definition.hostKinds.includes(hostKind)) return;
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        setRoute(id);
      });
      return;
    }
    setRoute(id);
  };

  useEffect(() => {
    if (!opts.onNavigationRequest) return;
    return opts.onNavigationRequest((request: unknown) => {
      if (!request || typeof request !== "object" || Array.isArray(request)) return;
      const pageId = (request as { pageId?: unknown }).pageId;
      if (typeof pageId !== "string") return;
      navigate(pageId);
    });
  }, [opts.onNavigationRequest, hostKind]);

  const keyboardRoutes = availableRoutes
    .filter((routeDef) => routeDef.shortcut)
    .slice(0, KEYBOARD_NAV_KEYS.length);
  useKeyboardShortcut(
    showOperatorRoutes
      ? keyboardRoutes.flatMap((routeDef, index) => {
          const key = KEYBOARD_NAV_KEYS[index];
          if (!key) return [];
          return {
            key,
            requireCmdOrCtrl: true,
            handler: () => {
              navigate(routeDef.id);
            },
          };
        })
      : [],
  );

  const platformRouteIds = new Set(platformItems.map((item) => item.id as OperatorUiRouteId));
  const isPlatformRoute = platformRouteIds.has(route);
  const showConnectPage =
    mode === "web" ? !showOperatorRoutes : !showOperatorRoutes && !isPlatformRoute;

  return {
    route,
    navigate,
    connection,
    autoSync,
    showShell,
    showOperatorRoutes,
    showConnectPage,
    sidebarItems: mode === "desktop" && !showOperatorRoutes ? [] : sidebarItems,
    mobileItems,
    mobileOverflowItems,
    platformItems,
  };
}
