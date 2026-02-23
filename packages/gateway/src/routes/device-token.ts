import { Hono } from "hono";
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

export function createDeviceTokenRoutes(deps: DeviceTokenRouteDeps): Hono {
  const app = new Hono();

  app.post("/auth/device-tokens/issue", async (c) => {
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
