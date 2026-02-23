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

const FORBIDDEN_BODY = {
  error: "forbidden",
  message: "insufficient scope",
};

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

export function resolveHttpRouteRequiredScopes(input: {
  method: string;
  routePath: string;
}): string[] | null {
  const method = input.method.toUpperCase();
  const routePath = input.routePath;

  // Tenant administration surfaces.
  if (
    routePath.startsWith("/auth/device-tokens") ||
    routePath.startsWith("/auth/profiles") ||
    routePath.startsWith("/audit") ||
    routePath.startsWith("/policy") ||
    routePath.startsWith("/plugins") ||
    routePath.startsWith("/providers/") ||
    routePath.startsWith("/secrets") ||
    routePath.startsWith("/snapshot") ||
    routePath === "/models/refresh" ||
    routePath.startsWith("/app/settings") ||
    routePath.startsWith("/app/actions/settings") ||
    routePath.startsWith("/app/actions/onboarding")
  ) {
    return ["operator.admin"];
  }

  // Dedicated approval surface.
  if (routePath.startsWith("/approvals") || routePath.startsWith("/app/approvals") || routePath.startsWith("/app/actions/approvals")) {
    return ["operator.approvals"];
  }

  // Pairing / device enrollment surface.
  if (routePath.startsWith("/pairings") || routePath.startsWith("/app/linking") || routePath.startsWith("/app/actions/linking")) {
    return ["operator.pairing"];
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
}): (c: Context, next: Next) => Promise<Response | void> {
  const resolveScopes = opts?.resolveScopes ?? resolveHttpRouteRequiredScopes;

  return async (c: Context, next: Next) => {
    const claims = getAuthClaims(c);
    if (!claims) {
      return next();
    }

    // Admin tokens are intentionally break-glass and are not scope-limited.
    if (claims.token_kind === "admin") {
      return next();
    }

    const routePath = getLeafRoutePath(c);
    if (!routePath) {
      return next();
    }

    const requiredScopes = resolveScopes({ method: c.req.method, routePath });
    if (!requiredScopes) {
      return c.json(
        {
          ...FORBIDDEN_BODY,
          message: "route is not scope-authorized for scoped tokens",
        },
        403,
      );
    }

    if (!hasAnyRequiredScope(claims, requiredScopes)) {
      return c.json(FORBIDDEN_BODY, 403);
    }

    return next();
  };
}
