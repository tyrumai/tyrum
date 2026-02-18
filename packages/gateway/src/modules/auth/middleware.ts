/**
 * HTTP authentication middleware for Hono.
 *
 * Enforces Bearer token authentication on all routes except /healthz.
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { TokenStore } from "./token-store.js";

const AUTH_ERROR_BODY = {
  error: "unauthorized",
  message: "Provide a valid token via Authorization: Bearer <token> header",
};

const AUTH_COOKIE_NAME = "tyrum_admin_token";
const APP_AUTH_PATH = "/app/auth";

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

function extractBootstrapToken(c: Context): string | undefined {
  if (c.req.path !== APP_AUTH_PATH) {
    return undefined;
  }
  return c.req.query("token")?.trim() || undefined;
}

export function createAuthMiddleware(
  tokenStore: TokenStore,
) {
  return async (c: Context, next: Next) => {
    // /healthz is always public
    if (c.req.path === "/healthz") {
      return next();
    }

    const bootstrapToken = extractBootstrapToken(c);
    const token =
      bootstrapToken ??
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
