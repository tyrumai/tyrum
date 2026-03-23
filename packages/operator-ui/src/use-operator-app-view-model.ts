import type { OperatorCore } from "@tyrum/operator-app";
import { useEffect, useRef, useState } from "react";
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
import {
  getActiveAgentIdsFromSessionLanes,
  resolveAgentIdForRun,
} from "./lib/status-session-lanes.js";
import {
  getOperatorRouteDefinition,
  OPERATOR_ROUTE_DEFINITIONS,
  SIDEBAR_SECTION_LABELS,
  type OperatorRouteDefinition,
  type OperatorUiRouteId,
  type SidebarSectionId,
} from "./operator-routes.js";
import type { HostKind } from "./host/host-api.js";
import type { SidebarNavItem } from "./components/layout/sidebar.js";
import { useOperatorStore } from "./use-operator-store.js";
import { useUrlRouting } from "./use-url-routing.js";

export interface SidebarGroup {
  id: SidebarSectionId;
  label: string;
  items: SidebarNavItem[];
}

export interface MobileOverflowGroup {
  id: string;
  label: string;
  items: SidebarNavItem[];
}

const KEYBOARD_NAV_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
const MOBILE_NAV_LABELS: Partial<Record<OperatorUiRouteId, string>> = {
  dashboard: "Home",
  chat: "Chat",
  approvals: "Review",
  workboard: "Work",
};

function isOperatorUiRouteId(value: string): value is OperatorUiRouteId {
  return OPERATOR_ROUTE_DEFINITIONS.some((r) => r.id === value);
}

function buildSidebarGroups(
  routes: readonly OperatorRouteDefinition[],
  toNavItem: (id: OperatorUiRouteId) => SidebarNavItem,
): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  for (const routeDef of routes) {
    const section = routeDef.sidebarSection;
    if (!section) continue;
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.id !== section) {
      groups.push({ id: section, label: SIDEBAR_SECTION_LABELS[section], items: [] });
    }
    groups[groups.length - 1]!.items.push(toNavItem(routeDef.id));
  }
  return groups;
}

export function useOperatorAppViewModel(opts: {
  core: OperatorCore;
  mode: "web" | "desktop";
  hostKind: HostKind;
  navigationLocked?: boolean;
  onNavigationRequest?: (handler: (request: unknown) => void) => (() => void) | undefined;
}) {
  const { core, mode, hostKind, navigationLocked = false } = opts;
  const urlRouting = useUrlRouting({
    hostKind,
    defaultRouteId: hostKind === "mobile" ? "mobile" : "dashboard",
  });
  const [route, setRoute] = useState<OperatorUiRouteId>(urlRouting.initialRouteId);
  const skipHistoryRef = useRef(false);
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
      mobileLabel: MOBILE_NAV_LABELS[routeId],
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
  const sidebarRoutes = availableRoutes.filter((item) => item.navGroup === "sidebar");
  const sidebarItems = sidebarRoutes.map((item) => toNavItem(item.id));
  const mobileItems = sidebarItems.slice(0, 4);
  const mobileOverflowItems = sidebarItems.slice(4);

  const sidebarGroups = buildSidebarGroups(sidebarRoutes, toNavItem);
  const mobileOverflowGroups = buildSidebarGroups(sidebarRoutes.slice(4), toNavItem);

  const platformItems = availableRoutes
    .filter((item) => {
      if (hostKind === "desktop") return item.navGroup === "platformDesktop";
      if (hostKind === "mobile") return item.navGroup === "platformMobile";
      return item.navGroup === "platformWeb";
    })
    .map((item) => toNavItem(item.id));

  const navigate = (id: string): void => {
    if (!isOperatorUiRouteId(id)) return;
    const definition = getOperatorRouteDefinition(id);
    if (!definition || !definition.hostKinds.includes(hostKind)) return;
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        setRoute(id);
        if (!skipHistoryRef.current) {
          urlRouting.pushRoute(id);
        }
      });
      return;
    }
    setRoute(id);
    if (!skipHistoryRef.current) {
      urlRouting.pushRoute(id);
    }
  };

  useEffect(() => {
    if (navigationLocked) return;
    if (!opts.onNavigationRequest) return;
    return opts.onNavigationRequest((request: unknown) => {
      if (!request || typeof request !== "object" || Array.isArray(request)) return;
      const pageId = (request as { pageId?: unknown }).pageId;
      if (typeof pageId !== "string") return;
      navigate(pageId);
    });
  }, [hostKind, navigationLocked, opts.onNavigationRequest]);

  useEffect(() => {
    if (navigationLocked) return;
    return urlRouting.onPopState((routeId) => {
      skipHistoryRef.current = true;
      navigate(routeId);
      skipHistoryRef.current = false;
    });
  }, [navigationLocked, urlRouting.onPopState]);

  const keyboardRoutes = availableRoutes
    .filter((routeDef) => routeDef.shortcut)
    .slice(0, KEYBOARD_NAV_KEYS.length);
  useKeyboardShortcut(
    showOperatorRoutes && !navigationLocked
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
  const supportsPlatformRouteWhileOffline = mode === "desktop" || hostKind === "mobile";
  const showConnectPage = supportsPlatformRouteWhileOffline
    ? !showOperatorRoutes && !isPlatformRoute
    : !showOperatorRoutes;

  return {
    route,
    navigate,
    initialConfigureTab: urlRouting.initialTab,
    replaceRoute: urlRouting.replaceRoute,
    connection,
    autoSync,
    showShell: showShell || hostKind === "mobile",
    showOperatorRoutes,
    showConnectPage,
    sidebarItems: mode === "desktop" && !showOperatorRoutes ? [] : sidebarItems,
    sidebarGroups: mode === "desktop" && !showOperatorRoutes ? [] : sidebarGroups,
    mobileItems,
    mobileOverflowItems,
    mobileOverflowGroups,
    platformItems,
  };
}
