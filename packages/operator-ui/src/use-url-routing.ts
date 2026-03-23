import { useEffect, useMemo, useRef } from "react";
import type { HostKind } from "./host/host-api.js";
import type { OperatorUiRouteId } from "./operator-routes.js";
import { buildRoutePath, isRouteValidForHost, parseRoute } from "./url-routing.js";

export interface UrlRoutingOptions {
  hostKind: HostKind;
  defaultRouteId: OperatorUiRouteId;
}

export interface UrlRoutingResult {
  /** Route ID parsed from the URL on mount (web) or the default (desktop/mobile). */
  initialRouteId: OperatorUiRouteId;
  /** Tab value parsed from ?tab= on mount, if present. */
  initialTab: string | undefined;
  /** Push a new history entry. No-op for non-web hosts. */
  pushRoute: (routeId: OperatorUiRouteId, tab?: string) => void;
  /** Replace the current history entry. No-op for non-web hosts. */
  replaceRoute: (routeId: OperatorUiRouteId, tab?: string) => void;
  /** Register a popstate handler. Returns a cleanup function. No-op for non-web hosts. */
  onPopState: (handler: (routeId: OperatorUiRouteId, tab?: string) => void) => () => void;
}

/**
 * Manages browser history integration for route state.
 * All operations are no-ops when `hostKind !== "web"`.
 */
export function useUrlRouting({ hostKind, defaultRouteId }: UrlRoutingOptions): UrlRoutingResult {
  const isWeb = hostKind === "web";

  const initial = useMemo(() => {
    if (!isWeb) return { routeId: defaultRouteId, tab: undefined };

    const parsed = parseRoute(window.location.pathname, window.location.search);
    if (parsed && isRouteValidForHost(parsed.routeId, hostKind)) {
      return { routeId: parsed.routeId, tab: parsed.tab };
    }
    return { routeId: defaultRouteId, tab: undefined };
    // Intentional: only compute on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Normalize URL on mount (e.g., /ui/ or /ui/unknown -> /ui/dashboard).
  const didNormalize = useRef(false);
  useEffect(() => {
    if (!isWeb || didNormalize.current) return;
    didNormalize.current = true;
    const currentPath = buildRoutePath(initial.routeId, initial.tab);
    const actualPath = window.location.pathname + window.location.search;
    if (actualPath !== currentPath) {
      window.history.replaceState(null, "", currentPath);
    }
  }, [isWeb, initial.routeId, initial.tab]);

  const pushRoute = useMemo(() => {
    if (!isWeb) return () => {};
    return (routeId: OperatorUiRouteId, tab?: string): void => {
      const path = buildRoutePath(routeId, tab);
      window.history.pushState(null, "", path);
    };
  }, [isWeb]);

  const replaceRoute = useMemo(() => {
    if (!isWeb) return () => {};
    return (routeId: OperatorUiRouteId, tab?: string): void => {
      const path = buildRoutePath(routeId, tab);
      window.history.replaceState(null, "", path);
    };
  }, [isWeb]);

  const onPopState = useMemo(() => {
    if (!isWeb) return () => () => {};
    return (handler: (routeId: OperatorUiRouteId, tab?: string) => void): (() => void) => {
      const listener = (): void => {
        const parsed = parseRoute(window.location.pathname, window.location.search);
        if (parsed && isRouteValidForHost(parsed.routeId, hostKind)) {
          handler(parsed.routeId, parsed.tab);
        }
      };
      window.addEventListener("popstate", listener);
      return () => {
        window.removeEventListener("popstate", listener);
      };
    };
    // hostKind is stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeb]);

  return {
    initialRouteId: initial.routeId,
    initialTab: initial.tab,
    pushRoute,
    replaceRoute,
    onPopState,
  };
}
