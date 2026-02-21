import { Hono } from "hono";
import type { AuthProfileDal } from "../modules/model/auth-profile-dal.js";
import type { EventPublisher } from "../modules/backplane/event-publisher.js";
import { randomUUID } from "node:crypto";

export interface ModelRouteDeps {
  authProfileDal: AuthProfileDal;
  eventPublisher?: EventPublisher;
}

export function createModelRoutes(deps: ModelRouteDeps): Hono {
  const app = new Hono();

  // GET /model/profiles — list all auth profiles
  app.get("/model/profiles", async (c) => {
    const profiles = await deps.authProfileDal.listAll();
    // Redact secret handles in response
    return c.json({ profiles: profiles.map(p => ({ ...p, secret_handle: p.secret_handle ? "***" : null })) });
  });

  // POST /model/profiles — create a new auth profile
  app.post("/model/profiles", async (c) => {
    const body = await c.req.json() as { provider?: string; label?: string; secret_handle?: string; priority?: number; metadata?: unknown };
    if (!body.provider) {
      return c.json({ error: "invalid_request", message: "provider is required" }, 400);
    }
    const profileId = randomUUID();
    const profile = await deps.authProfileDal.create({
      profileId,
      provider: body.provider,
      label: body.label,
      secretHandle: body.secret_handle,
      priority: body.priority,
      metadata: body.metadata,
    });

    void deps.eventPublisher?.publish("auth_profile.created", {
      profile_id: profileId,
      provider: body.provider,
    }).catch(() => {});

    return c.json({ profile }, 201);
  });

  // POST /model/profiles/:id/rotate — rotate/failover a profile
  app.post("/model/profiles/:id/rotate", async (c) => {
    const profileId = c.req.param("id");
    const profile = await deps.authProfileDal.getById(profileId);
    if (!profile) {
      return c.json({ error: "not_found", message: "profile not found" }, 404);
    }
    await deps.authProfileDal.deactivate(profileId);

    void deps.eventPublisher?.publish("auth_profile.updated", {
      profile_id: profileId,
      action: "rotated",
    }).catch(() => {});

    return c.json({ rotated: true, profile_id: profileId });
  });

  // DELETE /model/profiles/:id — deactivate profile
  app.delete("/model/profiles/:id", async (c) => {
    const profileId = c.req.param("id");
    await deps.authProfileDal.deactivate(profileId);

    void deps.eventPublisher?.publish("auth_profile.deleted", {
      profile_id: profileId,
    }).catch(() => {});

    return c.json({ deactivated: true });
  });

  return app;
}
