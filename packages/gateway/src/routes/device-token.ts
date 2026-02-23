import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
} from "@tyrum/schemas";
import type { TokenStore } from "../modules/auth/token-store.js";

export interface DeviceTokenRouteDeps {
  tokenStore: TokenStore;
}

const AUTH_COOKIE_NAME = "tyrum_admin_token";

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

function extractAuthToken(c: Context): string | undefined {
  return extractBearerToken(c.req.header("authorization")) ?? getCookie(c, AUTH_COOKIE_NAME);
}

function isAdminRequest(c: Context, tokenStore: TokenStore): boolean {
  const token = extractAuthToken(c);
  if (!token) return false;
  return tokenStore.validate(token);
}

export function createDeviceTokenRoutes(deps: DeviceTokenRouteDeps): Hono {
  const app = new Hono();

  app.post("/auth/device-tokens/issue", async (c) => {
    if (!isAdminRequest(c, deps.tokenStore)) {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

    const body = (await c.req.json()) as unknown;
    const parsed = DeviceTokenIssueRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    try {
      const issued = await deps.tokenStore.issueDeviceToken({
        deviceId: parsed.data.device_id,
        role: parsed.data.role,
        scopes: parsed.data.scopes,
        ttlSeconds: parsed.data.ttl_seconds,
      });
      return c.json(DeviceTokenIssueResponse.parse(issued), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
  });

  app.post("/auth/device-tokens/revoke", async (c) => {
    if (!isAdminRequest(c, deps.tokenStore)) {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

    const body = (await c.req.json()) as unknown;
    const parsed = DeviceTokenRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const claims = deps.tokenStore.inspectDeviceToken(parsed.data.token);
    const revoked = await deps.tokenStore.revokeDeviceToken(parsed.data.token);
    if (!revoked) {
      return c.json({ error: "not_found", message: "token not found or already revoked" }, 404);
    }
    return c.json(
      DeviceTokenRevokeResponse.parse({
        revoked: true,
        token_id: claims?.token_id,
      }),
      200,
    );
  });

  return app;
}
