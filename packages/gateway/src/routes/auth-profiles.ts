/**
 * Auth profile routes — durable provider credentials (by secret handle).
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
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
import type { AuthProfileDal } from "../modules/models/auth-profile-dal.js";
import type { SessionProviderPinDal } from "../modules/models/session-pin-dal.js";

export interface AuthProfileRouteDeps {
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
}

export function createAuthProfileRoutes(deps: AuthProfileRouteDeps): Hono {
  const app = new Hono();

  app.get("/auth/profiles", async (c) => {
    const agentId = c.req.query("agent_id")?.trim() || undefined;
    const provider = c.req.query("provider")?.trim() || undefined;
    const statusRaw = c.req.query("status")?.trim();
    const status = statusRaw === "active" || statusRaw === "disabled" ? statusRaw : undefined;

    const rows = await deps.authProfileDal.list({ agentId, provider, status });
    const profiles = rows.map((r) => AuthProfile.parse(r));
    return c.json(AuthProfileListResponse.parse({ profiles }));
  });

  app.post("/auth/profiles", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const profileId = randomUUID();
    const agentId = parsed.data.agent_id?.trim() || "default";

    const row = await deps.authProfileDal.create({
      profileId,
      agentId,
      provider: parsed.data.provider,
      type: parsed.data.type,
      secretHandles: parsed.data.secret_handles,
      labels: parsed.data.labels,
      expiresAt: parsed.data.expires_at ?? null,
      createdBy: parsed.data.created_by,
    });

    const profile = AuthProfile.parse(row);
    return c.json(AuthProfileCreateResponse.parse({ profile }), 201);
  });

  app.patch("/auth/profiles/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await deps.authProfileDal.updateProfile(id, {
      labels: parsed.data.labels,
      expiresAt: parsed.data.expires_at,
      updatedBy: parsed.data.updated_by,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: AuthProfile.parse(updated) });
  });

  app.post("/auth/profiles/:id/disable", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileDisableRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await deps.authProfileDal.disableProfile(id, {
      reason: parsed.data.reason,
      updatedBy: parsed.data.updated_by,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: AuthProfile.parse(updated) });
  });

  app.post("/auth/profiles/:id/enable", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as unknown;
    const parsed = AuthProfileEnableRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await deps.authProfileDal.enableProfile(id, {
      updatedBy: parsed.data.updated_by,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }

    return c.json({ status: "ok", profile: AuthProfile.parse(updated) });
  });

  app.get("/auth/pins", async (c) => {
    const agentId = c.req.query("agent_id")?.trim() || undefined;
    const sessionId = c.req.query("session_id")?.trim() || undefined;
    const provider = c.req.query("provider")?.trim() || undefined;
    const pins = await deps.pinDal.list({ agentId, sessionId, provider });
    return c.json(SessionProviderPinListResponse.parse({ pins: pins.map((p) => SessionProviderPin.parse(p)) }));
  });

  app.post("/auth/pins", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = SessionProviderPinSetRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const agentId = parsed.data.agent_id?.trim() || "default";
    if (parsed.data.profile_id === null) {
      const cleared = await deps.pinDal.clear({
        agentId,
        sessionId: parsed.data.session_id,
        provider: parsed.data.provider,
      });
      return c.json({ status: "ok", cleared });
    }

    const pin = await deps.pinDal.upsert({
      agentId,
      sessionId: parsed.data.session_id,
      provider: parsed.data.provider,
      profileId: parsed.data.profile_id,
    });
    return c.json({ status: "ok", pin: SessionProviderPin.parse(pin) }, 201);
  });

  return app;
}

