/**
 * HTTP scope authorization middleware for Hono.
 *
 * Enforces per-route scope checks for device tokens. Admin tokens are treated
 * as break-glass and bypass scope enforcement.
 *
 * This is intentionally deny-by-default for scoped tokens: if a route has no
 * required scope mapping, scoped tokens are forbidden.
 */

import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";
import type { AuthTokenClaims } from "../auth/token-store.js";
import { matchesPathPrefixSegment } from "../../app-path.js";
import type { AuthAudit } from "../auth/audit.js";
import { getClientIp } from "../auth/client-ip.js";
import { requestIdForAudit } from "../observability/request-id.js";

const FORBIDDEN_BODY = {
  error: "forbidden",
  message: "insufficient scope",
};

const METHOD_SCOPED_OPERATOR_ROUTE_PREFIXES = [
  "/agent",
  "/app",
  "/artifacts",
  "/canvas",
  "/connections",
  "/consent",
  "/context",
  "/contracts",
  "/ingress",
  "/memory",
  "/models",
  "/plan",
  "/playbooks",
  "/presence",
  "/runs",
  "/status",
  "/usage",
  "/watchers",
  "/workflow",
] as const satisfies readonly string[];

function getAuthClaims(c: Context): AuthTokenClaims | undefined {
  // Populated by createAuthMiddleware.
  const value = c.get("authClaims") as unknown;
  return value as AuthTokenClaims | undefined;
}

function getLeafRoutePath(c: Context): string | undefined {
  try {
    const routes = matchedRoutes(c);
    if (!Array.isArray(routes) || routes.length === 0) return undefined;

    // Filter out "*" middleware routes and pick the last concrete route.
    const concrete = routes.filter((route) => typeof route.path === "string" && route.path !== "*");
    const leaf = concrete.at(-1);
    return typeof leaf?.path === "string" ? leaf.path : undefined;
  } catch {
    return undefined;
  }
}

function hasAnyRequiredScope(claims: AuthTokenClaims, requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) return true;
  const scopes = Array.isArray(claims.scopes) ? claims.scopes : [];
  if (scopes.includes("*")) return true;
  return requiredScopes.some((scope) => scopes.includes(scope));
}

function isMethodScopedOperatorRoute(routePath: string): boolean {
  if (routePath === "/") return true;
  return METHOD_SCOPED_OPERATOR_ROUTE_PREFIXES.some((prefix) => matchesPathPrefixSegment(routePath, prefix));
}

export function resolveHttpRouteRequiredScopes(input: {
  method: string;
  routePath: string;
}): string[] | null {
  const method = input.method.toUpperCase();
  const routePath = input.routePath;

  // Tenant administration surfaces.
  if (
    matchesPathPrefixSegment(routePath, "/api") ||
    matchesPathPrefixSegment(routePath, "/auth") ||
    matchesPathPrefixSegment(routePath, "/audit") ||
    matchesPathPrefixSegment(routePath, "/policy") ||
    matchesPathPrefixSegment(routePath, "/routing") ||
    matchesPathPrefixSegment(routePath, "/plugins") ||
    matchesPathPrefixSegment(routePath, "/providers") ||
    matchesPathPrefixSegment(routePath, "/secrets") ||
    matchesPathPrefixSegment(routePath, "/snapshot") ||
    routePath === "/models/refresh" ||
    matchesPathPrefixSegment(routePath, "/app/settings") ||
    matchesPathPrefixSegment(routePath, "/app/actions/account") ||
    matchesPathPrefixSegment(routePath, "/app/actions/settings") ||
    matchesPathPrefixSegment(routePath, "/app/actions/onboarding")
  ) {
    return ["operator.admin"];
  }

  // Dedicated approval surface.
  if (
    matchesPathPrefixSegment(routePath, "/approvals") ||
    matchesPathPrefixSegment(routePath, "/app/approvals") ||
    matchesPathPrefixSegment(routePath, "/app/actions/approvals")
  ) {
    return ["operator.approvals"];
  }

  // Pairing / device enrollment surface.
  if (
    matchesPathPrefixSegment(routePath, "/pairings") ||
    matchesPathPrefixSegment(routePath, "/app/linking") ||
    matchesPathPrefixSegment(routePath, "/app/actions/linking")
  ) {
    return ["operator.pairing"];
  }

  if (!isMethodScopedOperatorRoute(routePath)) {
    return null;
  }

  // Default operator surface scopes by method.
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return ["operator.read"];
  }
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return ["operator.write"];
  }

  return null;
}

export function createHttpScopeAuthorizationMiddleware(opts?: {
  resolveScopes?: (input: { method: string; routePath: string }) => string[] | null;
  audit?: AuthAudit;
}): (c: Context, next: Next) => Promise<Response | void> {
  const resolveScopes = opts?.resolveScopes ?? resolveHttpRouteRequiredScopes;
  const audit = opts?.audit;

  return async (c: Context, next: Next) => {
    const claims = getAuthClaims(c);
    if (!claims) {
      return next();
    }

    // Admin tokens are intentionally break-glass and are not scope-limited.
    if (claims.token_kind === "admin") {
      return next();
    }

    // Prefer the router's matched route template (ex: "/approvals/:id") when available,
    // but fall back to the concrete request path to avoid failing open when route
    // metadata isn't exposed (ex: mocked matchedRoutes or unsupported router composition).
    const routePath = getLeafRoutePath(c) ?? c.req.path;

    const requiredScopes = resolveScopes({ method: c.req.method, routePath });
    if (!requiredScopes) {
      await audit?.recordAuthzDenied({
        surface: "http",
        reason: "not_scope_authorized",
        token: {
          token_kind: claims.token_kind,
          token_id: claims.token_id,
          device_id: claims.device_id,
          role: claims.role,
          scopes: claims.scopes,
        },
        required_scopes: null,
        method: c.req.method,
        path: routePath,
        request_id: requestIdForAudit(c),
        client_ip: getClientIp(c),
      });
      return c.json(
        {
          ...FORBIDDEN_BODY,
          message: "route is not scope-authorized for scoped tokens",
        },
        403,
      );
    }

    if (!hasAnyRequiredScope(claims, requiredScopes)) {
      await audit?.recordAuthzDenied({
        surface: "http",
        reason: "insufficient_scope",
        token: {
          token_kind: claims.token_kind,
          token_id: claims.token_id,
          device_id: claims.device_id,
          role: claims.role,
          scopes: claims.scopes,
        },
        required_scopes: requiredScopes,
        method: c.req.method,
        path: routePath,
        request_id: requestIdForAudit(c),
        client_ip: getClientIp(c),
      });
      return c.json(FORBIDDEN_BODY, 403);
    }

    return next();
  };
}
