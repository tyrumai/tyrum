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
import type { AuthTokenClaims } from "@tyrum/contracts";
import { hasAnyRequiredScope } from "../auth/scopes.js";
import type { AuthAudit } from "../auth/audit.js";
import { getClientIp } from "../auth/client-ip.js";
import { requestIdForAudit } from "../observability/request-id.js";
import { resolveHonoRoutePath } from "../../hono-route.js";
import { resolveGatewayHttpRequiredScopes } from "../../api/manifest.js";

const FORBIDDEN_BODY = {
  error: "forbidden",
  message: "insufficient scope",
};

function getAuthClaims(c: Context): AuthTokenClaims | undefined {
  // Populated by createAuthMiddleware.
  const value = c.get("authClaims") as unknown;
  return value as AuthTokenClaims | undefined;
}

export function resolveHttpRouteRequiredScopes(input: {
  method: string;
  routePath: string;
}): string[] | null {
  return resolveGatewayHttpRequiredScopes(input);
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
    const routePath = resolveHonoRoutePath(c);
    const requestPath = c.req.path;
    let requiredScopes = resolveScopes({ method: c.req.method, routePath });
    if (!requiredScopes && routePath !== requestPath) {
      requiredScopes = resolveScopes({ method: c.req.method, routePath: requestPath });
    }
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
