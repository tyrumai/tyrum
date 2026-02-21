/**
 * Secret management REST routes.
 *
 * Provides endpoints for storing, listing, and revoking secret handles.
 * Secret values are never returned — only opaque handles.
 */

import { Hono } from "hono";
import { SecretRotateRequest, SecretStoreRequest } from "@tyrum/schemas";
import { EnvSecretProvider, type SecretProvider } from "../modules/secret/provider.js";

export interface SecretRouteDeps {
  secretProviderForAgent: (agentId: string) => Promise<SecretProvider>;
}

function agentIdFromReq(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): string {
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

    const { scope, value, provider } = parsed.data;

    // Only allow storing via the active provider — the provider field
    // is informational; we always delegate to the wired SecretProvider.
    void provider;

    let secretProvider: SecretProvider;
    try {
      secretProvider = await deps.secretProviderForAgent(agentIdFromReq(c));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

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
      return c.json(
        { error: "not_found", message: `secret ${handleId} not found` },
        404,
      );
    }

    return c.json({ revoked: true });
  });

  /**
   * Rotate a secret handle by revoking the old handle and returning a new one
   * for the same scope. (The secret value is never returned.)
   */
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
    return c.json({ revoked, handle }, 201);
  });

  return app;
}
