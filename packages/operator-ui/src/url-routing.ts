import { OPERATOR_ROUTE_DEFINITIONS, type OperatorUiRouteId } from "./operator-routes.js";
import type { HostKind } from "./host/host-api.js";

const URL_BASE_PATH = "/ui/";

const VALID_ROUTE_IDS = new Set<string>(OPERATOR_ROUTE_DEFINITIONS.map((r) => r.id));

export interface ParsedRoute {
  routeId: OperatorUiRouteId;
  tab?: string;
}

/**
 * Parse a pathname + search string into a validated route.
 * Returns `null` for unknown or invalid paths.
 */
export function parseRoute(pathname: string, search: string): ParsedRoute | null {
  if (!pathname.startsWith(URL_BASE_PATH)) return null;

  const tail = pathname.slice(URL_BASE_PATH.length).replace(/\/+$/, "");
  if (!tail || !VALID_ROUTE_IDS.has(tail)) return null;

  const routeId = tail as OperatorUiRouteId;

  if (routeId === "configure") {
    const params = new URLSearchParams(search);
    const tab = params.get("tab");
    return tab && tab !== "general" ? { routeId, tab } : { routeId };
  }

  return { routeId };
}

/**
 * Build a URL path for a given route ID and optional tab.
 * The default configure tab ("general") is omitted from the URL.
 */
export function buildRoutePath(routeId: OperatorUiRouteId, tab?: string): string {
  const base = `${URL_BASE_PATH}${routeId}`;
  if (routeId === "configure" && tab && tab !== "general") {
    return `${base}?tab=${encodeURIComponent(tab)}`;
  }
  return base;
}

/**
 * Check whether a route ID is valid for the given host kind.
 */
export function isRouteValidForHost(routeId: OperatorUiRouteId, hostKind: HostKind): boolean {
  const definition = OPERATOR_ROUTE_DEFINITIONS.find((r) => r.id === routeId);
  return definition !== undefined && definition.hostKinds.includes(hostKind);
}
