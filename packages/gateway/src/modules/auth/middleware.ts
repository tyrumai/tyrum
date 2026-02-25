/**
 * HTTP authentication middleware for Hono.
 *
 * Enforces token authentication on all routes except /healthz.
 * Web UI routes under /app may also authenticate via ?token=...
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { matchedRoutes } from "hono/route";
import { APP_PATH_PREFIX, matchesPathPrefixSegment } from "../../app-path.js";
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

const APP_TOKEN_QUERY_KEY = "token";
const OAUTH_CALLBACK_ROUTE_PATH_SUFFIX = "/providers/:provider/oauth/callback";
const OAUTH_CALLBACK_REQUEST_PATH_PATTERN = /(?:^|\/)providers\/[^/]+\/oauth\/callback$/;

function extractAppQueryToken(c: Context): string | undefined {
  // Guard against prefix-collisions like "/application" or "/appdata".
  if (!matchesPathPrefixSegment(c.req.path, APP_PATH_PREFIX)) {
    return undefined;
  }
  return c.req.query(APP_TOKEN_QUERY_KEY)?.trim() || undefined;
}

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

    // OAuth callback is public (state/PKCE-protected) and should not require an admin token.
    // Use the router's matched route to avoid accidentally exempting other paths with similar suffixes.
    if (isPublicOAuthCallbackRoute(c)) {
      return next();
    }

    // Accept query-token auth for the web UI path subtree. This keeps
    // embedded desktop navigation working when third-party cookies are blocked.
    const appQueryToken = extractAppQueryToken(c);
    const bearerToken = extractBearerToken(c.req.header("authorization"));
    const cookieToken = getCookie(c, AUTH_COOKIE_NAME);
    const token = appQueryToken ?? bearerToken ?? cookieToken;
    const tokenTransport = appQueryToken
      ? "query"
      : bearerToken
        ? "authorization"
        : cookieToken
          ? "cookie"
          : "missing";
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
