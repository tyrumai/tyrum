/**
 * Secret management REST routes.
 *
 * Stores secret values in the database (encrypted at rest) and returns only
 * stable external handles (never secret values).
 */

import { Hono } from "hono";
import { SecretRotateRequest, SecretStoreRequest } from "@tyrum/schemas";
import { SecretAlreadyExistsError, type SecretProvider } from "../modules/secret/provider.js";

export interface SecretRouteDeps {
  secretProviderForAgent: (agentId: string) => Promise<SecretProvider>;
}

function agentIdFromReq(c: {
  req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined };
}): string {
  return c.req.query("agent_id")?.trim() || c.req.header("x-tyrum-agent-id")?.trim() || "default";
}

export function createSecretRoutes(deps: SecretRouteDeps): Hono {
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

    let secretProvider: SecretProvider;
    try {
      secretProvider = await deps.secretProviderForAgent(agentIdFromReq(c));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

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
    let secretProvider: SecretProvider;
    try {
      secretProvider = await deps.secretProviderForAgent(agentIdFromReq(c));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const handles = await secretProvider.list();
    return c.json({ handles });
  });

  /** Revoke a secret by handle ID. */
  app.delete("/secrets/:id", async (c) => {
    const handleId = c.req.param("id");
    let secretProvider: SecretProvider;
    try {
      secretProvider = await deps.secretProviderForAgent(agentIdFromReq(c));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const revoked = await secretProvider.revoke(handleId);

    if (!revoked) {
      return c.json({ error: "not_found", message: `secret ${handleId} not found` }, 404);
    }

    return c.json({ revoked: true });
  });

  /** Rotate a secret by publishing a new version under the same handle. */
  app.post("/secrets/:id/rotate", async (c) => {
    const handleId = c.req.param("id");
    let secretProvider: SecretProvider;
    try {
      secretProvider = await deps.secretProviderForAgent(agentIdFromReq(c));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

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
