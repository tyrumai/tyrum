/**
 * Auth profile management routes.
 *
 * Profiles store metadata + secret handles; raw credentials are never returned.
 */

import { Hono } from "hono";
import { AuthProfileCreateResponse, AuthProfileListResponse } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { Logger } from "../modules/observability/logger.js";
import type { SecretProvider } from "../modules/secret/provider.js";
import { AuthProfileService } from "../modules/auth-profiles/service.js";
import { AuthProfileDal } from "../modules/auth-profiles/dal.js";

export function createAuthProfileRoutes(deps: {
  db: SqlDb;
  secretProvider?: SecretProvider;
  logger?: Logger;
}): Hono {
  const app = new Hono();
  const dal = new AuthProfileDal(deps.db);

  app.get("/auth/profiles", async (c) => {
    const agentId = c.req.query("agent_id")?.trim();
    const provider = c.req.query("provider")?.trim();

    const profiles = await dal.list({
      agentId: agentId || undefined,
      provider: provider || undefined,
    });
    return c.json(AuthProfileListResponse.parse({ profiles }));
  });

  app.post("/auth/profiles", async (c) => {
    if (!deps.secretProvider) {
      return c.json({ error: "misconfigured", message: "secret provider not configured" }, 503);
    }

    const raw = await c.req.json().catch(() => undefined);
    if (!raw) {
      return c.json({ error: "invalid_request", message: "invalid JSON body" }, 400);
    }

    try {
      const service = new AuthProfileService(deps.db, deps.secretProvider, deps.logger);
      const profile = await service.create(raw);
      return c.json(AuthProfileCreateResponse.parse({ profile }), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
  });

  app.delete("/auth/profiles/:profileId", async (c) => {
    const profileId = c.req.param("profileId");
    if (!profileId || profileId.trim().length === 0) {
      return c.json({ error: "invalid_request", message: "profileId is required" }, 400);
    }

    const deleted = await dal.delete(profileId);
    if (!deleted) {
      return c.json({ error: "not_found", message: `auth profile ${profileId} not found` }, 404);
    }

    if (deps.secretProvider) {
      const handles = Object.values(deleted.secret_handles ?? {});
      for (const handle of handles) {
        void deps.secretProvider.revoke(handle.handle_id).catch(() => false);
      }
    }

    return c.json({ deleted: true });
  });

  return app;
}
