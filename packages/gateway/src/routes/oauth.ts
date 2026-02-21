/**
 * OAuth helper routes (device-code flow).
 *
 * These endpoints are provider-agnostic; operators supply the OAuth endpoints.
 * Raw tokens are stored via the configured SecretProvider and never returned.
 */

import { Hono } from "hono";
import { AuthProfileCreateResponse } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { Logger } from "../modules/observability/logger.js";
import type { SecretProvider } from "../modules/secret/provider.js";
import { AuthProfileService } from "../modules/auth-profiles/service.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseUrl(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createOAuthRoutes(deps: {
  db: SqlDb;
  secretProvider?: SecretProvider;
  logger?: Logger;
}): Hono {
  const app = new Hono();

  app.post("/auth/oauth/device/start", async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "invalid_request", message: "expected JSON object body" }, 400);
    }
    const body = raw as Record<string, unknown>;

    const deviceAuthUrl = parseUrl(body["device_authorization_url"]);
    const tokenUrl = parseUrl(body["token_url"]);
    const clientId = isNonEmptyString(body["client_id"]) ? body["client_id"].trim() : undefined;
    const scope = typeof body["scope"] === "string" ? body["scope"].trim() : undefined;

    if (!deviceAuthUrl || !tokenUrl || !clientId) {
      return c.json(
        { error: "invalid_request", message: "device_authorization_url, token_url, and client_id are required" },
        400,
      );
    }

    try {
      const params = new URLSearchParams();
      params.set("client_id", clientId);
      if (scope) params.set("scope", scope);

      const res = await fetch(deviceAuthUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: params,
      });

      const text = await res.text();
      if (!res.ok) {
        return c.json({ error: "oauth_error", message: `device start failed (${res.status}): ${text}` }, 502);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return c.json({ error: "oauth_error", message: "device start returned non-JSON response" }, 502);
      }

      if (!parsed || typeof parsed !== "object") {
        return c.json({ error: "oauth_error", message: "device start returned non-object JSON response" }, 502);
      }
      const parsedObject = parsed as Record<string, unknown>;

      return c.json({
        ok: true,
        token_url: tokenUrl,
        client_id: clientId,
        ...parsedObject,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.error("oauth.device_start_failed", { error: message });
      return c.json({ error: "oauth_error", message }, 502);
    }
  });

  app.post("/auth/oauth/device/complete", async (c) => {
    if (!deps.secretProvider) {
      return c.json({ error: "misconfigured", message: "secret provider not configured" }, 503);
    }

    const raw = await c.req.json().catch(() => undefined);
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "invalid_request", message: "expected JSON object body" }, 400);
    }
    const body = raw as Record<string, unknown>;

    const agentId = isNonEmptyString(body["agent_id"]) ? body["agent_id"].trim() : "default";
    const provider = isNonEmptyString(body["provider"]) ? body["provider"].trim() : undefined;
    const tokenUrl = parseUrl(body["token_url"]);
    const clientId = isNonEmptyString(body["client_id"]) ? body["client_id"].trim() : undefined;
    const deviceCode = isNonEmptyString(body["device_code"]) ? body["device_code"].trim() : undefined;

    if (!provider || !tokenUrl || !clientId || !deviceCode) {
      return c.json(
        {
          error: "invalid_request",
          message: "provider, token_url, client_id, and device_code are required",
        },
        400,
      );
    }

    const service = new AuthProfileService(deps.db, deps.secretProvider, deps.logger);

    try {
      const params = new URLSearchParams();
      params.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
      params.set("device_code", deviceCode);
      params.set("client_id", clientId);

      const res = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: params,
      });

      const text = await res.text();
      if (!res.ok) {
        return c.json({ error: "oauth_error", message: `device complete failed (${res.status}): ${text}` }, 502);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return c.json({ error: "oauth_error", message: "device complete returned non-JSON response" }, 502);
      }
      if (!parsed || typeof parsed !== "object") {
        return c.json({ error: "oauth_error", message: "device complete returned invalid JSON" }, 502);
      }

      const record = parsed as Record<string, unknown>;
      const accessToken = typeof record["access_token"] === "string" ? record["access_token"] : undefined;
      const refreshToken = typeof record["refresh_token"] === "string" ? record["refresh_token"] : undefined;
      const expiresIn = typeof record["expires_in"] === "number" ? record["expires_in"] : undefined;
      if (!accessToken || !refreshToken) {
        return c.json({ error: "oauth_error", message: "missing access_token/refresh_token in response" }, 502);
      }

      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;

      const profile = await service.create({
        agent_id: agentId,
        provider,
        type: "oauth",
        token_url: tokenUrl,
        client_id: clientId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      });

      return c.json(AuthProfileCreateResponse.parse({ profile }), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.error("oauth.device_complete_failed", { error: message });
      return c.json({ error: "oauth_error", message }, 502);
    }
  });

  return app;
}
