/**
 * HTTP authentication middleware for Hono.
 *
 * Enforces Bearer token authentication on all routes except /healthz.
 * When the gateway is bound to localhost only, auth is skipped (single-user mode).
 */

import type { Context, Next } from "hono";
import type { TokenStore } from "./token-store.js";

export function createAuthMiddleware(
  tokenStore: TokenStore,
  isLocalOnly: boolean,
) {
  return async (c: Context, next: Next) => {
    // /healthz is always public
    if (c.req.path === "/healthz") {
      return next();
    }

    // Single-user local mode — no auth required
    if (isLocalOnly) {
      return next();
    }

    const authHeader = c.req.header("authorization");
    if (!authHeader) {
      return c.json(
        {
          error: "unauthorized",
          message:
            "Provide a valid token via Authorization: Bearer <token> header",
        },
        401,
      );
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return c.json(
        {
          error: "unauthorized",
          message:
            "Provide a valid token via Authorization: Bearer <token> header",
        },
        401,
      );
    }

    if (!tokenStore.validate(parts[1])) {
      return c.json(
        {
          error: "unauthorized",
          message:
            "Provide a valid token via Authorization: Bearer <token> header",
        },
        401,
      );
    }

    return next();
  };
}
