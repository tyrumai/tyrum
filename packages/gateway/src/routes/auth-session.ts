import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AuthTokenService } from "../app/modules/auth/auth-token-service.js";
import { AUTH_COOKIE_NAME } from "../app/modules/auth/http.js";

export interface AuthSessionRouteDeps {
  authTokens: AuthTokenService;
}

function isHttpsRequest(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch (err) {
    void err;
    return false;
  }
}

export function createAuthSessionRoutes(deps: AuthSessionRouteDeps): Hono {
  const app = new Hono();

  app.post("/auth/session", async (c) => {
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const tokenRaw =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)["token"]
        : undefined;
    const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
    if (!token) {
      return c.json({ error: "invalid_request", message: "token is required" }, 400);
    }

    const claims = await deps.authTokens.authenticate(token);
    if (!claims) {
      return c.json({ error: "unauthorized", message: "invalid token" }, 401);
    }

    if (claims.tenant_id === null) {
      return c.json({ error: "forbidden", message: "system tokens cannot start sessions" }, 403);
    }
    if (claims.role !== "admin") {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

    setCookie(c, AUTH_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 604800,
      secure: isHttpsRequest(c.req.url),
    });

    return c.body(null, 204);
  });

  app.post("/auth/logout", (c) => {
    setCookie(c, AUTH_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 0,
      secure: isHttpsRequest(c.req.url),
    });

    return c.body(null, 204);
  });

  return app;
}
