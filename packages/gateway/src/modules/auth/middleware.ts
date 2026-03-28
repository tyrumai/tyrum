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
import type { Logger } from "../observability/logger.js";
import type { AuthTokenClaims } from "@tyrum/contracts";
import type { AuthTokenService } from "./auth-token-service.js";
import { AUTH_COOKIE_NAME, extractBearerToken } from "./http.js";
import type { AuthAudit } from "./audit.js";
import { matchesDesktopTakeoverProxyPath } from "../desktop-environments/takeover-token.js";

const AUTH_ERROR_BODY = {
  error: "unauthorized",
  message: "Provide a valid token via Authorization: Bearer <token> header",
};

const AUTH_UNAVAILABLE_BODY = {
  error: "service_unavailable",
  message: "Authentication service is unavailable; please try again later.",
};

const AUTH_CONVERSATION_ROUTE_PATH = "/auth/cookie";
const AUTH_LOGOUT_ROUTE_PATH = "/auth/logout";
const UI_PATH_PREFIX = "/ui";
const DESKTOP_TAKEOVER_PATH_PREFIX = "/desktop-takeover/s";
const TELEGRAM_INGRESS_ROUTE_PATH = "/ingress/telegram";
const GOOGLECHAT_INGRESS_ROUTE_PATH = "/ingress/googlechat";
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
    // Intentional: continue to path-shape fallback when route metadata isn't available.
  }
  return OAUTH_CALLBACK_REQUEST_PATH_PATTERN.test(c.req.path);
}

type PublicPathExemption = Readonly<{
  label: string;
  matches: (c: Context) => boolean;
}>;

export const PUBLIC_PATHS: readonly PublicPathExemption[] = [
  {
    label: "/healthz",
    matches: (c) => c.req.path === "/healthz",
  },
  {
    label: `${UI_PATH_PREFIX}/*`,
    matches: (c) => matchesPathPrefixSegment(c.req.path, UI_PATH_PREFIX),
  },
  {
    label: `${DESKTOP_TAKEOVER_PATH_PREFIX}/*`,
    matches: (c) => matchesDesktopTakeoverProxyPath(c.req.path),
  },
  {
    label: AUTH_CONVERSATION_ROUTE_PATH,
    matches: (c) => c.req.path === AUTH_CONVERSATION_ROUTE_PATH,
  },
  {
    label: AUTH_LOGOUT_ROUTE_PATH,
    matches: (c) => c.req.path === AUTH_LOGOUT_ROUTE_PATH,
  },
  {
    label: TELEGRAM_INGRESS_ROUTE_PATH,
    matches: (c) => c.req.method === "POST" && c.req.path === TELEGRAM_INGRESS_ROUTE_PATH,
  },
  {
    label: GOOGLECHAT_INGRESS_ROUTE_PATH,
    matches: (c) => c.req.method === "POST" && c.req.path === GOOGLECHAT_INGRESS_ROUTE_PATH,
  },
  {
    label: OAUTH_CALLBACK_ROUTE_PATH_SUFFIX,
    matches: (c) => isPublicOAuthCallbackRoute(c),
  },
];

function matchPublicPathExemption(c: Context): PublicPathExemption | undefined {
  for (const exemption of PUBLIC_PATHS) {
    try {
      if (exemption.matches(c)) return exemption;
    } catch {
      // Intentional: fail closed when path matchers throw.
    }
  }
  return undefined;
}

export function createAuthMiddleware(
  authTokens: AuthTokenService | undefined,
  opts?: {
    audit?: AuthAudit;
    logger?: Logger;
  },
) {
  let didLogMissingAuthTokens = false;
  return async (c: Context, next: Next) => {
    if (!authTokens) {
      if (!didLogMissingAuthTokens) {
        didLogMissingAuthTokens = true;
        opts?.logger?.error("auth.token_store_missing", {
          client_ip: getClientIp(c),
          method: c.req.method,
          path: c.req.path,
          request_id: requestIdForAudit(c),
        });
      }
      return c.json(AUTH_UNAVAILABLE_BODY, 503);
    }

    const publicPathExemption = matchPublicPathExemption(c);
    if (publicPathExemption) {
      opts?.logger?.debug("auth.public_path_exempted", {
        exemption: publicPathExemption.label,
        client_ip: getClientIp(c),
        method: c.req.method,
        path: c.req.path,
        request_id: requestIdForAudit(c),
      });
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

    const claims: AuthTokenClaims | null = await authTokens.authenticate(token);
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

    const isSystemRoute = matchesPathPrefixSegment(c.req.path, "/system");
    const isSystemToken = claims.tenant_id === null;
    if (isSystemRoute && !isSystemToken) {
      return c.json(
        {
          error: "forbidden",
          message: "system token required",
        },
        403,
      );
    }
    if (!isSystemRoute && isSystemToken) {
      return c.json(
        {
          error: "forbidden",
          message: "system token is not valid for tenant routes",
        },
        403,
      );
    }

    c.set("authClaims", claims);
    return next();
  };
}
