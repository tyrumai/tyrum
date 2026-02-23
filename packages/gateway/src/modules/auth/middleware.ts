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
import type { TokenStore } from "./token-store.js";

const AUTH_ERROR_BODY = {
  error: "unauthorized",
  message: "Provide a valid token via Authorization: Bearer <token> header",
};

const AUTH_COOKIE_NAME = "tyrum_admin_token";
const APP_TOKEN_QUERY_KEY = "token";
const OAUTH_CALLBACK_ROUTE_PATH_RE = /\/providers\/:[^/]+\/oauth\/callback$/;

function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }

  const parts = authorizationHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return undefined;
  }

  return parts[1];
}

function extractAppQueryToken(c: Context): string | undefined {
  // Guard against prefix-collisions like "/application" or "/appdata".
  if (!matchesPathPrefixSegment(c.req.path, APP_PATH_PREFIX)) {
    return undefined;
  }
  return c.req.query(APP_TOKEN_QUERY_KEY)?.trim() || undefined;
}

function isPublicOAuthCallbackRoute(c: Context): boolean {
  if (c.req.method !== "GET") return false;
  // Use matched router paths so we don't accidentally exempt concrete request paths with similar suffixes.
  return matchedRoutes(c).some((route) => OAUTH_CALLBACK_ROUTE_PATH_RE.test(route.path));
}

export function createAuthMiddleware(
  tokenStore: TokenStore,
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
    const token =
      appQueryToken ??
      extractBearerToken(c.req.header("authorization")) ??
      getCookie(c, AUTH_COOKIE_NAME);
    if (!token) {
      return c.json(
        AUTH_ERROR_BODY,
        401,
      );
    }

    if (!tokenStore.validate(token)) {
      return c.json(
        AUTH_ERROR_BODY,
        401,
      );
    }

    return next();
  };
}
