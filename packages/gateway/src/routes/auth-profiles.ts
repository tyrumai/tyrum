/**
 * Auth profile routes — durable provider credentials (tenant-scoped).
 */

import { Hono } from "hono";
import {
  AuthProfile,
  AuthProfileCreateRequest,
  AuthProfileCreateResponse,
  AuthProfileDisableRequest,
  AuthProfileEnableRequest,
  AuthProfileListResponse,
  AuthProfileUpdateRequest,
  SessionProviderPin,
  SessionProviderPinListResponse,
  SessionProviderPinSetRequest,
} from "@tyrum/schemas";
import type { AuthProfileDal, AuthProfileRow } from "../modules/models/auth-profile-dal.js";
import type {
  SessionProviderPinDal,
  SessionProviderPinRow,
} from "../modules/models/session-pin-dal.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";

export interface AuthProfileRouteDeps {
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
}

function toContractProfile(row: AuthProfileRow) {
  const { tenant_id: _tenantId, ...rest } = row;
  return AuthProfile.parse(rest);
}

function toContractPin(row: SessionProviderPinRow) {
  const { tenant_id: _tenantId, ...rest } = row;
  return SessionProviderPin.parse(rest);
}

export function createAuthProfileRoutes(deps: AuthProfileRouteDeps): Hono {
  const app = new Hono();

  app.get("/auth/profiles", async (c) => {
    const providerKey = c.req.query("provider_key")?.trim() || undefined;
    const statusRaw = c.req.query("status")?.trim();
    const status = statusRaw === "active" || statusRaw === "disabled" ? statusRaw : undefined;

    const rows = await deps.authProfileDal.list({
      tenantId: DEFAULT_TENANT_ID,
      providerKey,
      status,
    });
    const profiles = rows.map(toContractProfile);
    return c.json(AuthProfileListResponse.parse({ profiles }));
  });

  app.post("/auth/profiles", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const row = await deps.authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: parsed.data.auth_profile_key,
      providerKey: parsed.data.provider_key,
      type: parsed.data.type,
      secretKeys: parsed.data.secret_keys,
      labels: parsed.data.labels,
    });

    const profile = toContractProfile(row);
    return c.json(AuthProfileCreateResponse.parse({ profile }), 201);
  });

  app.patch("/auth/profiles/:key", async (c) => {
    const authProfileKey = c.req.param("key");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await deps.authProfileDal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey,
      labels: parsed.data.labels,
      secretKeys: parsed.data.secret_keys,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: toContractProfile(updated) });
  });

  app.post("/auth/profiles/:key/disable", async (c) => {
    const authProfileKey = c.req.param("key");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileDisableRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    void parsed;

    const updated = await deps.authProfileDal.disableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: toContractProfile(updated) });
  });

  app.post("/auth/profiles/:key/enable", async (c) => {
    const authProfileKey = c.req.param("key");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileEnableRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    void parsed;

    const updated = await deps.authProfileDal.enableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: toContractProfile(updated) });
  });

  app.get("/auth/pins", async (c) => {
    const sessionId = c.req.query("session_id")?.trim() || undefined;
    const providerKey = c.req.query("provider_key")?.trim() || undefined;
    const pins = await deps.pinDal.list({
      tenantId: DEFAULT_TENANT_ID,
      sessionId,
      providerKey,
    });
    return c.json(SessionProviderPinListResponse.parse({ pins: pins.map(toContractPin) }));
  });

  app.post("/auth/pins", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = SessionProviderPinSetRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    if (parsed.data.auth_profile_key === null) {
      const cleared = await deps.pinDal.clear({
        tenantId: DEFAULT_TENANT_ID,
        sessionId: parsed.data.session_id,
        providerKey: parsed.data.provider_key,
      });
      return c.json({ status: "ok", cleared });
    }

    const profile = await deps.authProfileDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: parsed.data.auth_profile_key,
    });
    if (!profile) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    const pin = await deps.pinDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: parsed.data.session_id,
      providerKey: parsed.data.provider_key,
      authProfileId: profile.auth_profile_id,
    });
    return c.json({ status: "ok", pin: toContractPin(pin) }, 201);
  });

  return app;
}
