/**
 * Secret management REST routes.
 *
 * Provides endpoints for storing, listing, and revoking secret handles.
 * Secret values are never returned — only opaque handles.
 */

import { Hono } from "hono";
import { SecretRotateRequest, SecretStoreRequest } from "@tyrum/schemas";
import { EnvSecretProvider, type SecretProvider } from "../modules/secret/provider.js";
import type { EventPublisher } from "../modules/backplane/event-publisher.js";

export interface SecretRouteDeps {
  secretProvider: SecretProvider;
  eventPublisher?: EventPublisher;
}

export function createSecretRoutes(deps: SecretRouteDeps): Hono {
  const { secretProvider, eventPublisher } = deps;
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

    if (!(secretProvider instanceof EnvSecretProvider) && (!value || value.trim().length === 0)) {
      return c.json(
        {
          error: "invalid_request",
          message: "value is required for non-env secret providers",
        },
        400,
      );
    }

    const handle = await secretProvider.store(scope, value ?? "");
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

    void eventPublisher?.publish("secret.revoked", { handle_id: handleId }).catch(() => {});

    return c.json({ revoked: true });
  });

  /**
   * Rotate a secret handle by revoking the old handle and returning a new one
   * for the same scope. (The secret value is never returned.)
   */
  app.post("/secrets/:id/rotate", async (c) => {
    const handleId = c.req.param("id");
    const handles = await secretProvider.list();
    const existing = handles.find((h) => h.handle_id === handleId);
    if (!existing) {
      return c.json(
        { error: "not_found", message: `secret ${handleId} not found` },
        404,
      );
    }

    if (secretProvider instanceof EnvSecretProvider) {
      return c.json(
        {
          error: "invalid_request",
          message: "env secrets cannot be rotated via API; update the backing environment value instead",
        },
        400,
      );
    }

    const raw = await c.req.json();
    const parsed = SecretRotateRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
        400,
      );
    }

    const handle = await secretProvider.store(existing.scope, parsed.data.value);
    const revoked = await secretProvider.revoke(handleId);

    void eventPublisher?.publish("secret.rotated", {
      old_handle_id: handleId,
      new_handle_id: handle.handle_id,
      scope: existing.scope,
    }).catch(() => {});

    return c.json({ revoked, handle }, 201);
  });

  return app;
}
