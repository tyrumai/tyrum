/**
 * Secret management REST routes.
 *
 * Provides endpoints for storing, listing, and revoking secret handles.
 * Secret values are never returned — only opaque handles.
 */

import { Hono } from "hono";
import { SecretRotateRequest, SecretStoreRequest } from "@tyrum/schemas";
import { EnvSecretProvider, type SecretProvider } from "../modules/secret/provider.js";
import type { AuthProfileDal } from "../modules/models/auth-profile-dal.js";

export interface SecretRouteDeps {
  secretProviderForAgent: (agentId: string) => Promise<SecretProvider>;
  authProfileDal?: AuthProfileDal;
}

function agentIdFromReq(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): string {
  return c.req.query("agent_id")?.trim() || c.req.header("x-tyrum-agent-id")?.trim() || "default";
}

function replacesSecretHandleId(input: Record<string, string>, from: string, to: string): { changed: boolean; next: Record<string, string> } {
  let changed = false;
  const next: Record<string, string> = { ...input };
  for (const [k, v] of Object.entries(next)) {
    if (v === from) {
      next[k] = to;
      changed = true;
    }
  }
  return { changed, next };
}

async function disableAuthProfilesReferencingSecretHandleId(params: {
  authProfileDal: AuthProfileDal;
  agentId: string;
  handleId: string;
}): Promise<void> {
  const profiles = await params.authProfileDal.list({ agentId: params.agentId, limit: 500 });
  for (const profile of profiles) {
    const handleIds = Object.values(profile.secret_handles ?? {});
    if (!handleIds.includes(params.handleId)) continue;
    await params.authProfileDal.disableProfile(profile.profile_id, {
      reason: "secret_handle_revoked",
      updatedBy: { kind: "secret_revoke", handle_id: params.handleId },
    });
  }
}

async function rotateAuthProfilesReferencingSecretHandleId(params: {
  authProfileDal: AuthProfileDal;
  agentId: string;
  fromHandleId: string;
  toHandleId: string;
}): Promise<void> {
  if (params.fromHandleId === params.toHandleId) return;

  const profiles = await params.authProfileDal.list({ agentId: params.agentId, limit: 500 });
  for (const profile of profiles) {
    const { changed, next } = replacesSecretHandleId(
      profile.secret_handles ?? {},
      params.fromHandleId,
      params.toHandleId,
    );
    if (!changed) continue;
    await params.authProfileDal.updateSecretHandles(profile.profile_id, {
      secretHandles: next,
      updatedBy: {
        kind: "secret_rotate",
        from_handle_id: params.fromHandleId,
        to_handle_id: params.toHandleId,
      },
    });
  }
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

    if (deps.authProfileDal) {
      await disableAuthProfilesReferencingSecretHandleId({
        authProfileDal: deps.authProfileDal,
        agentId: agentIdFromReq(c),
        handleId,
      });
    }

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
    if (deps.authProfileDal) {
      try {
        await rotateAuthProfilesReferencingSecretHandleId({
          authProfileDal: deps.authProfileDal,
          agentId: agentIdFromReq(c),
          fromHandleId: handleId,
          toHandleId: handle.handle_id,
        });
      } catch (err) {
        await secretProvider.revoke(handle.handle_id).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          { error: "internal_error", message: `secret rotation failed: ${message}` },
          500,
        );
      }
    }

    const revoked = await secretProvider.revoke(handleId);
    return c.json({ revoked, handle }, 201);
  });

  return app;
}
