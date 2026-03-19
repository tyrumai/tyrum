/**
 * Secret management REST routes.
 *
 * Stores secret values in the database (encrypted at rest) and returns only
 * stable external handles (never secret values).
 */

import { Hono } from "hono";
import { SecretRotateRequest, SecretStoreRequest } from "@tyrum/contracts";
import { SecretAlreadyExistsError, type SecretProvider } from "../modules/secret/provider.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface SecretRouteDeps {
  secretProviderForTenant: (tenantId: string) => SecretProvider;
}

export function createSecretRoutes(deps: SecretRouteDeps): Hono {
  const app = new Hono();

  /** Store a new secret and return its handle (never the value). */
  app.post("/secrets", async (c) => {
    const tenantId = requireTenantId(c);
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

    const secretProvider = deps.secretProviderForTenant(tenantId);

    const secretKey = parsed.data.secret_key;
    try {
      const handle = await secretProvider.store(secretKey, parsed.data.value, { createOnly: true });
      return c.json({ handle }, 201);
    } catch (err) {
      if (err instanceof SecretAlreadyExistsError) {
        return c.json({ error: "conflict", message: err.message }, 409);
      }
      throw err;
    }
  });

  /** List all secret handles (never values). */
  app.get("/secrets", async (c) => {
    const tenantId = requireTenantId(c);
    const secretProvider = deps.secretProviderForTenant(tenantId);
    const handles = await secretProvider.list();
    return c.json({ handles });
  });

  /** Revoke a secret by handle ID. */
  app.delete("/secrets/:id", async (c) => {
    const handleId = c.req.param("id");
    const tenantId = requireTenantId(c);
    const secretProvider = deps.secretProviderForTenant(tenantId);
    const revoked = await secretProvider.revoke(handleId);

    if (!revoked) {
      return c.json({ error: "not_found", message: `secret ${handleId} not found` }, 404);
    }

    return c.json({ revoked: true });
  });

  /** Rotate a secret by publishing a new version under the same handle. */
  app.post("/secrets/:id/rotate", async (c) => {
    const handleId = c.req.param("id");
    const tenantId = requireTenantId(c);
    const secretProvider = deps.secretProviderForTenant(tenantId);

    const handles = await secretProvider.list();
    const existing = handles.find((h) => h.handle_id === handleId);
    if (!existing) {
      return c.json({ error: "not_found", message: `secret ${handleId} not found` }, 404);
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

    const handle = await secretProvider.store(existing.handle_id, parsed.data.value);
    return c.json({ revoked: true, handle }, 201);
  });

  return app;
}
