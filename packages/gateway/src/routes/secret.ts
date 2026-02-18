/**
 * Secret management REST routes.
 *
 * Provides endpoints for storing, listing, and revoking secret handles.
 * Secret values are never returned — only opaque handles.
 */

import { Hono } from "hono";
import { SecretStoreRequest } from "@tyrum/schemas";
import type { SecretProvider } from "../modules/secret/provider.js";

export function createSecretRoutes(secretProvider: SecretProvider): Hono {
  const app = new Hono();

  /** Store a new secret and return its handle (never the value). */
  app.post("/secrets", async (c) => {
    const raw = await c.req.json();
    const parsed = SecretStoreRequest.safeParse(raw);

    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
        400,
      );
    }

    const { scope, value, provider } = parsed.data;

    // Only allow storing via the active provider — the provider field
    // is informational; we always delegate to the wired SecretProvider.
    void provider;

    const handle = await secretProvider.store(scope, value);
    return c.json({ handle }, 201);
  });

  /** List all secret handles (never values). */
  app.get("/secrets", async (c) => {
    const handles = await secretProvider.list();
    return c.json({ handles });
  });

  /** Revoke a secret by handle ID. */
  app.delete("/secrets/:id", async (c) => {
    const handleId = c.req.param("id");
    const revoked = await secretProvider.revoke(handleId);

    if (!revoked) {
      return c.json(
        { error: "not_found", message: `secret ${handleId} not found` },
        404,
      );
    }

    return c.json({ revoked: true });
  });

  return app;
}
