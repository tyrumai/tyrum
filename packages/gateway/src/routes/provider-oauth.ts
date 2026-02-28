/**
 * Provider OAuth routes — authorization-code + PKCE flows that store tokens as auth profiles.
 *
 * Routes:
 * - POST /providers/:provider/oauth/authorize  -> returns authorize_url + state
 * - GET  /providers/:provider/oauth/callback   -> exchanges code, stores tokens, creates auth profile
 */

import { Hono, type Context } from "hono";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OauthPendingDal } from "../modules/oauth/pending-dal.js";
import type { OAuthProviderRegistry } from "../modules/oauth/provider-registry.js";
import { exchangeAuthorizationCode, resolveOAuthEndpoints } from "../modules/oauth/oauth-client.js";
import type { SecretProvider } from "../modules/secret/provider.js";
import type { AuthProfileDal } from "../modules/models/auth-profile-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import { coerceRecord, coerceString } from "../modules/util/coerce.js";
import { safeDetail } from "../utils/safe-detail.js";

const PENDING_TTL_MS = 10 * 60 * 1000;

function base64Url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function sha256Base64Url(input: string): string {
  const hash = createHash("sha256").update(input, "utf-8").digest();
  return base64Url(hash);
}

function computeExpiresAt(nowMs: number, expiresIn: number | undefined): string | null {
  if (!Number.isFinite(expiresIn) || !expiresIn || expiresIn <= 0) return null;
  return new Date(nowMs + Math.floor(expiresIn) * 1000).toISOString();
}

function computeRequestBaseUrl(c: Context, publicBaseUrl?: string): string {
  if (publicBaseUrl) {
    const parsed = new URL(publicBaseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("public_base_url must be http(s)");
    }
    parsed.hash = "";
    parsed.search = "";
    const base = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
    return base;
  }

  const requestUrl = new URL(c.req.url);
  const path = requestUrl.pathname.replace(/\/$/, "");

  // Preserve any mount prefix when the gateway is served under a subpath (e.g. /prefix).
  // Route handlers are mounted at `/providers/...`, so keep everything before the *last*
  // `/providers/` segment and drop the rest.
  const providersIdx = path.lastIndexOf("/providers/");
  const mountPrefix = providersIdx >= 0 ? path.slice(0, providersIdx) : "";
  return `${requestUrl.origin}${mountPrefix}`.replace(/\/$/, "");
}

function renderHtml(title: string, message: string): string {
  const escapeHtml = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 24px; }
      code { background: #f4f4f5; padding: 2px 6px; border-radius: 6px; }
      .box { max-width: 720px; margin: 0 auto; }
      .muted { color: #52525b; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <p class="muted">You can close this window.</p>
    </div>
  </body>
</html>`;
}

export interface ProviderOAuthRouteDeps {
  oauthPendingDal: OauthPendingDal;
  oauthProviderRegistry: OAuthProviderRegistry;
  authProfileDal: AuthProfileDal;
  secretProviderForAgent: (agentId: string) => Promise<SecretProvider>;
  logger?: Logger;
}

export function createProviderOAuthRoutes(deps: ProviderOAuthRouteDeps): Hono {
  const app = new Hono();

  app.post("/providers/:provider/oauth/authorize", async (c) => {
    const providerId = c.req.param("provider");
    const body = await c.req.json().catch(() => ({}));
    const record = coerceRecord(body) ?? {};
    const agentId = coerceString(record["agent_id"]) ?? "default";
    const publicBaseUrl = coerceString(record["public_base_url"]);

    const spec = await deps.oauthProviderRegistry.get(providerId);
    if (!spec) {
      return c.json(
        { error: "not_found", message: `oauth provider '${providerId}' not configured` },
        404,
      );
    }

    try {
      await deps.secretProviderForAgent(agentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }

    const clientIdEnv = coerceString(spec.client_id_env);
    if (!clientIdEnv) {
      return c.json(
        { error: "invalid_config", message: "oauth provider missing client_id_env" },
        500,
      );
    }
    const clientId = process.env[clientIdEnv]?.trim();
    if (!clientId) {
      return c.json({ error: "missing_env", message: `missing env var ${clientIdEnv}` }, 400);
    }

    const { authorizationEndpoint, tokenEndpoint } = await resolveOAuthEndpoints(spec);
    if (!authorizationEndpoint || !tokenEndpoint) {
      return c.json(
        {
          error: "invalid_config",
          message: "oauth provider missing authorization/token endpoints",
        },
        500,
      );
    }

    const state = randomUUID();
    const pkceVerifier = base64Url(randomBytes(32));
    const pkceChallenge = sha256Base64Url(pkceVerifier);

    let baseUrl: string;
    try {
      baseUrl = computeRequestBaseUrl(c, publicBaseUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message: msg }, 400);
    }

    const redirectUri = `${baseUrl}/providers/${providerId}/oauth/callback`;
    const scope = (spec.scopes ?? []).join(" ").trim();

    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", pkceChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (scope) {
      authorizeUrl.searchParams.set("scope", scope);
    }
    for (const [k, v] of Object.entries(spec.extra_authorize_params ?? {})) {
      authorizeUrl.searchParams.set(k, v);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + PENDING_TTL_MS).toISOString();

    await deps.oauthPendingDal.deleteExpired(nowIso).catch((err) => {
      deps.logger?.warn("oauth.pending_delete_expired_failed", {
        provider: providerId,
        error: safeDetail(err) ?? "unknown_error",
      });
    });
    await deps.oauthPendingDal.create({
      state,
      provider_id: providerId,
      agent_id: agentId,
      created_at: nowIso,
      expires_at: expiresAt,
      pkce_verifier: pkceVerifier,
      redirect_uri: redirectUri,
      scopes: scope,
      mode: "auth_code",
      metadata: {
        user_agent: c.req.header("user-agent") ?? null,
      },
    });

    return c.json({
      status: "ok",
      provider: providerId,
      state,
      expires_at: expiresAt,
      authorize_url: authorizeUrl.toString(),
    });
  });

  app.get("/providers/:provider/oauth/callback", async (c) => {
    const providerId = c.req.param("provider");
    const state = c.req.query("state")?.trim();
    const code = c.req.query("code")?.trim();
    const error = c.req.query("error")?.trim();
    const errorDescription = c.req.query("error_description")?.trim();

    if (error) {
      // Consume the pending row (if present) so OAuth `state` remains single-use even on error callbacks.
      if (state) {
        await deps.oauthPendingDal.consume(state).catch((err) => {
          deps.logger?.warn("oauth.pending_consume_failed", {
            provider: providerId,
            error: safeDetail(err) ?? "unknown_error",
          });
        });
      }
      return c.html(
        renderHtml(
          "Authorization failed",
          errorDescription ? `${error}: ${errorDescription}` : error,
        ),
        400,
      );
    }

    if (!state || !code) {
      return c.html(
        renderHtml("Authorization failed", "Missing required query parameters: state and code"),
        400,
      );
    }

    const pending = await deps.oauthPendingDal.get(state);
    if (!pending) {
      return c.html(
        renderHtml(
          "Authorization failed",
          "Unknown or expired authorization request (state not found). Please retry.",
        ),
        400,
      );
    }
    if (pending.provider_id !== providerId) {
      return c.html(
        renderHtml(
          "Authorization failed",
          "Provider mismatch for OAuth callback (state belongs to a different provider).",
        ),
        400,
      );
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    if (pending.expires_at <= nowIso) {
      await deps.oauthPendingDal.delete(state).catch((err) => {
        deps.logger?.warn("oauth.pending_delete_failed", {
          provider: providerId,
          error: safeDetail(err) ?? "unknown_error",
        });
      });
      return c.html(
        renderHtml("Authorization failed", "OAuth request expired. Please retry."),
        400,
      );
    }
    const consumed = await deps.oauthPendingDal.consume(state);
    if (!consumed) {
      return c.html(
        renderHtml(
          "Authorization failed",
          "Unknown or expired authorization request (state not found). Please retry.",
        ),
        400,
      );
    }

    const spec = await deps.oauthProviderRegistry.get(providerId);
    if (!spec) {
      return c.html(
        renderHtml("Authorization failed", `oauth provider '${providerId}' not configured`),
        404,
      );
    }

    const clientIdEnv = coerceString(spec.client_id_env);
    if (!clientIdEnv) {
      return c.html(
        renderHtml("Authorization failed", "oauth provider missing client_id_env"),
        500,
      );
    }
    const clientId = process.env[clientIdEnv]?.trim();
    if (!clientId) {
      return c.html(renderHtml("Authorization failed", `missing env var ${clientIdEnv}`), 400);
    }

    const clientSecretEnv = coerceString(spec.client_secret_env);
    const clientSecret = clientSecretEnv ? process.env[clientSecretEnv]?.trim() : undefined;

    let secretProvider: SecretProvider | undefined;
    const createdHandleIds: string[] = [];
    let profileCreated = false;

    try {
      const { tokenEndpoint } = await resolveOAuthEndpoints(spec, {
        requireAuthorizationEndpoint: false,
      });
      if (!tokenEndpoint) {
        return c.html(
          renderHtml("Authorization failed", "oauth provider missing token endpoint"),
          500,
        );
      }

      const token = await exchangeAuthorizationCode({
        tokenEndpoint,
        clientId,
        clientSecret,
        tokenEndpointBasicAuth: spec.token_endpoint_basic_auth,
        code,
        redirectUri: consumed.redirect_uri,
        pkceVerifier: consumed.pkce_verifier,
        scope: consumed.scopes || undefined,
        extraParams: spec.extra_token_params,
      });

      secretProvider = await deps.secretProviderForAgent(consumed.agent_id);
      const accessHandle = await secretProvider.store(
        `oauth:${providerId}:${consumed.agent_id}:access`,
        token.access_token,
      );
      createdHandleIds.push(accessHandle.handle_id);

      const secretHandles: Record<string, string> = {
        access_token_handle: accessHandle.handle_id,
      };

      if (token.refresh_token) {
        const refreshHandle = await secretProvider.store(
          `oauth:${providerId}:${consumed.agent_id}:refresh`,
          token.refresh_token,
        );
        createdHandleIds.push(refreshHandle.handle_id);
        secretHandles["refresh_token_handle"] = refreshHandle.handle_id;
      }

      const profileId = randomUUID();
      const expiresAt = computeExpiresAt(nowMs, token.expires_in);

      const profile = await deps.authProfileDal.create({
        profileId,
        agentId: consumed.agent_id,
        provider: providerId,
        type: "oauth",
        secretHandles,
        labels: {
          scopes: consumed.scopes,
          token_type: token.token_type ?? null,
          oauth: true,
        },
        expiresAt,
        createdBy: { kind: "oauth_callback" },
      });
      profileCreated = true;

      deps.logger?.info("oauth.authorized", {
        provider: providerId,
        agent_id: consumed.agent_id,
        profile_id: profile.profile_id,
      });

      const wantsJson = (c.req.header("accept") ?? "").includes("application/json");
      if (wantsJson) {
        return c.json({ status: "ok", provider: providerId, profile_id: profile.profile_id });
      }

      return c.html(
        renderHtml(
          "Authorization complete",
          `Saved credentials for ${providerId} as profile ${profile.profile_id}.`,
        ),
        200,
      );
    } catch (err) {
      if (secretProvider && !profileCreated && createdHandleIds.length > 0) {
        await Promise.all(
          createdHandleIds.map((handleId) => secretProvider!.revoke(handleId).catch(() => false)),
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn("oauth.callback_failed", {
        provider: providerId,
        error: safeDetail(err) ?? "unknown_error",
      });
      return c.html(renderHtml("Authorization failed", message), 502);
    }
  });

  return app;
}
