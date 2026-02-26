/**
 * HTTP authentication middleware for Hono.
 *
 * Enforces token authentication on all routes except a small public allowlist
 * (health checks, web UI shell, and auth bootstrap endpoints).
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { matchedRoutes } from "hono/route";
import { matchesPathPrefixSegment } from "../../app-path.js";
import { getClientIp } from "./client-ip.js";
import { requestIdForAudit } from "../observability/request-id.js";
import type { TokenStore } from "./token-store.js";
import type { AuthTokenClaims } from "./token-store.js";
import { AUTH_COOKIE_NAME, extractBearerToken } from "./http.js";
import type { AuthAudit } from "./audit.js";

const AUTH_ERROR_BODY = {
  error: "unauthorized",
  message: "Provide a valid token via Authorization: Bearer <token> header",
};

const AUTH_SESSION_ROUTE_PATH = "/auth/session";
const AUTH_LOGOUT_ROUTE_PATH = "/auth/logout";
const UI_PATH_PREFIX = "/ui";
const OAUTH_CALLBACK_ROUTE_PATH_SUFFIX = "/providers/:provider/oauth/callback";
const OAUTH_CALLBACK_REQUEST_PATH_PATTERN = /(?:^|\/)providers\/[^/]+\/oauth\/callback$/;

function isPublicOAuthCallbackRoute(c: Context): boolean {
  if (c.req.method !== "GET") return false;
  try {
    // Use the router's matched route to avoid accidentally exempting other concrete request paths with a similar suffix.
    if (matchedRoutes(c).some((route) => route.path.endsWith(OAUTH_CALLBACK_ROUTE_PATH_SUFFIX))) {
      return true;
    }
  } catch {
    // Continue to path-shape fallback when route metadata isn't available.
  }
  return OAUTH_CALLBACK_REQUEST_PATH_PATTERN.test(c.req.path);
}

export function createAuthMiddleware(
  tokenStore: TokenStore,
  opts?: {
    audit?: AuthAudit;
  },
) {
  return async (c: Context, next: Next) => {
    // /healthz is always public
    if (c.req.path === "/healthz") {
      return next();
    }

    // /ui/* is public (static operator SPA).
    if (matchesPathPrefixSegment(c.req.path, UI_PATH_PREFIX)) {
      return next();
    }

    // Cookie bootstrap/logout endpoints must be accessible before authentication.
    if (c.req.path === AUTH_SESSION_ROUTE_PATH || c.req.path === AUTH_LOGOUT_ROUTE_PATH) {
      return next();
    }

    // OAuth callback is public (state/PKCE-protected) and should not require an admin token.
    // Use the router's matched route to avoid accidentally exempting other paths with similar suffixes.
    if (isPublicOAuthCallbackRoute(c)) {
      return next();
    }

    const bearerToken = extractBearerToken(c.req.header("authorization"));
    const cookieToken = getCookie(c, AUTH_COOKIE_NAME);
    const token = bearerToken ?? cookieToken;
    const tokenTransport = bearerToken ? "authorization" : cookieToken ? "cookie" : "missing";
    if (!token) {
      await opts?.audit?.recordAuthFailed({
        surface: "http",
        reason: "missing_token",
        token_transport: tokenTransport,
        client_ip: getClientIp(c),
        method: c.req.method,
        path: c.req.path,
        user_agent: c.req.header("user-agent")?.trim() || undefined,
        request_id: requestIdForAudit(c),
      });
      return c.json(AUTH_ERROR_BODY, 401);
    }

    const claims: AuthTokenClaims | null = tokenStore.authenticate(token);
    if (!claims) {
      await opts?.audit?.recordAuthFailed({
        surface: "http",
        reason: "invalid_token",
        token_transport: tokenTransport,
        client_ip: getClientIp(c),
        method: c.req.method,
        path: c.req.path,
        user_agent: c.req.header("user-agent")?.trim() || undefined,
        request_id: requestIdForAudit(c),
      });
      return c.json(AUTH_ERROR_BODY, 401);
    }

    c.set("authClaims", claims);
    return next();
  };
}
