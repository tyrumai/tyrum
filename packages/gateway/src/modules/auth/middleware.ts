/**
 * HTTP authentication middleware for Hono.
 *
 * Enforces Bearer token authentication on all routes except /healthz.
 */

import type { Context, Next } from "hono";
import type { TokenStore } from "./token-store.js";

export function createAuthMiddleware(
  tokenStore: TokenStore,
) {
  return async (c: Context, next: Next) => {
    // /healthz is always public
    if (c.req.path === "/healthz") {
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
