import { APICallError } from "ai";
import type { GatewayContainer } from "../../../container.js";
import { refreshAccessToken, resolveOAuthEndpoints } from "../../oauth/oauth-client.js";
import { AuthProfileDal, type AuthProfileRow } from "../../models/auth-profile-dal.js";
import { isAuthProfilesEnabled } from "../../models/auth-profiles-enabled.js";
import { SessionProviderPinDal } from "../../models/session-pin-dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import {
  createSecretHandleResolver,
  type SecretHandleResolver,
} from "../../secret/handle-resolver.js";

export function parseProviderModelId(model: string): { providerId: string; modelId: string } {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`invalid model '${model}' (expected provider/model)`);
  }
  return {
    providerId: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

export function isAuthInvalidStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

export function isTransientStatus(status: number | undefined): boolean {
  if (status == null) return true;
  return status === 429 || status >= 500;
}

export function isCredentialPaymentOrEntitlementStatus(status: number | undefined): boolean {
  return status === 402;
}

export function getStopFallbackApiCallError(err: unknown): APICallError | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5; i++) {
    if (APICallError.isInstance(current)) {
      const status = current.statusCode;
      if (status == null) return undefined;
      if (isTransientStatus(status)) return undefined;
      if (isAuthInvalidStatus(status)) return undefined;
      if (isCredentialPaymentOrEntitlementStatus(status)) return undefined;
      if (status === 404) return undefined;
      return current;
    }
    if (current instanceof Error && typeof current.cause !== "undefined") {
      current = current.cause;
      continue;
    }
    return undefined;
  }
  return undefined;
}

export function resolveEnvApiKey(providerEnv: readonly string[] | undefined): string | undefined {
  for (const key of providerEnv ?? []) {
    if (!/(_API_KEY|_TOKEN)$/i.test(key)) continue;
    const raw = process.env[key];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function resolveProviderBaseURL(input: {
  providerEnv: readonly string[] | undefined;
  providerApi: string | undefined;
  options?: Record<string, unknown> | undefined;
}): string | undefined {
  const raw =
    input.options?.["baseURL"] ??
    input.options?.["baseUrl"] ??
    input.options?.["base_url"] ??
    undefined;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  const endpointKey = (input.providerEnv ?? []).find((key) =>
    /(ENDPOINT|BASE_URL|BASEURL|URL)$/i.test(key),
  );
  const endpoint = endpointKey ? process.env[endpointKey]?.trim() : undefined;
  if (endpoint && endpoint.length > 0) {
    return endpoint;
  }

  const api = input.providerApi?.trim();
  if (api && api.length > 0) {
    return api;
  }

  return undefined;
}

export async function listOrderedEligibleProfilesForProvider(input: {
  agentId: string;
  sessionId: string;
  providerId: string;
  resolver: SecretHandleResolver | undefined;
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
}): Promise<AuthProfileRow[]> {
  const eligibleProfiles =
    isAuthProfilesEnabled() && input.resolver
      ? await input.authProfileDal.listEligibleForProvider({
          agentId: input.agentId,
          provider: input.providerId,
          nowMs: Date.now(),
        })
      : [];

  if (eligibleProfiles.length === 0) return [];

  const pin = await input.pinDal.get({
    agentId: input.agentId,
    sessionId: input.sessionId,
    provider: input.providerId,
  });
  const pinnedId = pin?.profile_id;

  return pinnedId
    ? [...eligibleProfiles].sort((a, b) =>
        a.profile_id === pinnedId ? -1 : b.profile_id === pinnedId ? 1 : 0,
      )
    : eligibleProfiles;
}

export function buildProviderResolutionSetup(input: {
  container: GatewayContainer;
  secretProvider: SecretProvider | undefined;
  oauthLeaseOwner: string;
  fetchImpl: typeof fetch;
}): {
  secretProvider: SecretProvider | undefined;
  resolver: SecretHandleResolver | undefined;
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
  oauthProviderRegistry: GatewayContainer["oauthProviderRegistry"];
  oauthRefreshLeaseDal: GatewayContainer["oauthRefreshLeaseDal"];
  logger: GatewayContainer["logger"];
  oauthLeaseOwner: string;
  fetchImpl: typeof fetch;
} {
  const secretProvider = input.secretProvider;
  const resolver = secretProvider ? createSecretHandleResolver(secretProvider) : undefined;

  return {
    secretProvider,
    resolver,
    authProfileDal: new AuthProfileDal(input.container.db),
    pinDal: new SessionProviderPinDal(input.container.db),
    oauthProviderRegistry: input.container.oauthProviderRegistry,
    oauthRefreshLeaseDal: input.container.oauthRefreshLeaseDal,
    logger: input.container.logger,
    oauthLeaseOwner: input.oauthLeaseOwner,
    fetchImpl: input.fetchImpl,
  };
}

export async function resolveProfileApiKey(
  profile: AuthProfileRow,
  deps: {
    secretProvider: SecretProvider | undefined;
    resolver: SecretHandleResolver | undefined;
    authProfileDal: AuthProfileDal;
    oauthProviderRegistry: GatewayContainer["oauthProviderRegistry"];
    oauthRefreshLeaseDal: GatewayContainer["oauthRefreshLeaseDal"];
    oauthLeaseOwner: string;
    logger: GatewayContainer["logger"];
    fetchImpl: typeof fetch;
  },
  opts?: { forceOAuthRefresh?: boolean },
): Promise<string | null> {
  const {
    secretProvider,
    resolver,
    authProfileDal,
    oauthProviderRegistry,
    oauthRefreshLeaseDal,
    oauthLeaseOwner,
    logger,
    fetchImpl,
  } = deps;

  async function maybeRefreshOAuthAccessToken(input?: { force?: boolean }): Promise<string | null> {
    if (profile.type !== "oauth") return null;
    if (!secretProvider || !resolver) return null;

    const nowMs = Date.now();
    const refreshThresholdMs = 60_000;
    const force = input?.force ?? false;

    const expiresAtMs = (() => {
      const expiresAt = profile.expires_at;
      if (!expiresAt) return Number.NaN;
      const parsed = Date.parse(expiresAt);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    })();

    if (!force) {
      if (!Number.isFinite(expiresAtMs)) return null;
      if (expiresAtMs - nowMs > refreshThresholdMs) return null;
    }

    const refreshHandleId = profile.secret_handles?.["refresh_token_handle"];
    if (!refreshHandleId) return null;

    const acquired = await oauthRefreshLeaseDal.tryAcquire({
      profileId: profile.profile_id,
      owner: oauthLeaseOwner,
      nowMs,
      leaseTtlMs: 60_000,
    });
    if (!acquired) {
      // Another instance is refreshing (or the lease is stuck); sync in-memory handles
      // from the latest row so we don't attempt a revoked access handle.
      const latest = await authProfileDal.getById(profile.profile_id);
      if (latest && latest.updated_at !== profile.updated_at) {
        profile.secret_handles = latest.secret_handles;
        profile.expires_at = latest.expires_at;
        profile.updated_at = latest.updated_at;
        await resolver.refresh().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("secret.handle_resolver_refresh_failed", {
            profile_id: profile.profile_id,
            error: msg,
          });
        });
      }
      return null;
    }

    let createdAccessHandleId: string | undefined;
    let createdRefreshHandleId: string | undefined;
    let updateAttempted = false;

    try {
      const latest = await authProfileDal.getById(profile.profile_id);
      const current = latest ?? profile;

      const currentExpiresAt = current.expires_at;
      if (currentExpiresAt) {
        const currentExpiresAtMs = Date.parse(currentExpiresAt);
        if (
          Number.isFinite(currentExpiresAtMs) &&
          currentExpiresAtMs - nowMs > refreshThresholdMs
        ) {
          if (latest && latest.updated_at !== profile.updated_at) {
            profile.secret_handles = latest.secret_handles;
            profile.expires_at = latest.expires_at;
            profile.updated_at = latest.updated_at;
            await resolver.refresh().catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn("secret.handle_resolver_refresh_failed", {
                profile_id: profile.profile_id,
                error: msg,
              });
            });
          }
          return null;
        }
      }

      const currentRefreshHandleId =
        current.secret_handles?.["refresh_token_handle"] ?? refreshHandleId;
      const refreshToken = await resolver.resolveById(currentRefreshHandleId);
      if (!refreshToken) return null;

      const spec = await oauthProviderRegistry.get(current.provider);
      if (!spec) return null;

      const clientIdEnv = spec.client_id_env?.trim();
      if (!clientIdEnv) return null;
      const clientId = process.env[clientIdEnv]?.trim();
      if (!clientId) return null;

      const clientSecretEnv = spec.client_secret_env?.trim();
      const clientSecret = clientSecretEnv ? process.env[clientSecretEnv]?.trim() : undefined;

      const { tokenEndpoint } = await resolveOAuthEndpoints(spec, {
        fetchImpl,
        requireAuthorizationEndpoint: false,
      });
      if (!tokenEndpoint) return null;

      const scope = (spec.scopes ?? []).join(" ").trim();
      const token = await refreshAccessToken({
        tokenEndpoint,
        clientId,
        clientSecret,
        tokenEndpointBasicAuth: spec.token_endpoint_basic_auth,
        refreshToken,
        scope: scope || undefined,
        extraParams: spec.extra_token_params,
        fetchImpl,
      });

      const accessToken = token.access_token?.trim();
      if (!accessToken) return null;

      const accessHandle = await secretProvider.store(
        `oauth:${current.provider}:${current.agent_id}:access`,
        accessToken,
      );
      createdAccessHandleId = accessHandle.handle_id;

      const nextSecretHandles: Record<string, string> = { ...current.secret_handles };
      const oldAccessHandleId = nextSecretHandles["access_token_handle"];
      nextSecretHandles["access_token_handle"] = accessHandle.handle_id;

      const refreshTokenNew = token.refresh_token?.trim();
      let oldRefreshHandleId: string | undefined;
      let newRefreshHandleId: string | undefined;
      if (refreshTokenNew) {
        const refreshHandle = await secretProvider.store(
          `oauth:${current.provider}:${current.agent_id}:refresh`,
          refreshTokenNew,
        );
        oldRefreshHandleId = nextSecretHandles["refresh_token_handle"];
        nextSecretHandles["refresh_token_handle"] = refreshHandle.handle_id;
        newRefreshHandleId = refreshHandle.handle_id;
        createdRefreshHandleId = refreshHandle.handle_id;
      }

      const nextExpiresAt = (() => {
        const expiresIn = token.expires_in;
        if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
          return new Date(nowMs + Math.floor(expiresIn) * 1000).toISOString();
        }
        // If the refresh response omits expires_in, clear the stored expiry so we don't keep
        // treating a newly-refreshed token as already expired.
        return null;
      })();

      updateAttempted = true;
      const updated = await authProfileDal.updateSecretHandles(current.profile_id, {
        secretHandles: nextSecretHandles,
        expiresAt: nextExpiresAt,
        updatedBy: { kind: "oauth_refresh" },
      });

      if (!updated) {
        await secretProvider.revoke(accessHandle.handle_id).catch(() => {});
        if (newRefreshHandleId) {
          await secretProvider.revoke(newRefreshHandleId).catch(() => {});
        }
        return accessToken;
      }

      if (oldAccessHandleId && oldAccessHandleId !== accessHandle.handle_id) {
        await secretProvider.revoke(oldAccessHandleId).catch(() => {});
      }
      if (oldRefreshHandleId && newRefreshHandleId && oldRefreshHandleId !== newRefreshHandleId) {
        await secretProvider.revoke(oldRefreshHandleId).catch(() => {});
      }

      // Keep the in-memory snapshot in sync so subsequent calls in the same turn
      // don't try to resolve a revoked handle.
      profile.secret_handles = updated.secret_handles;
      profile.expires_at = updated.expires_at;
      profile.updated_at = updated.updated_at;
      await resolver.refresh().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("secret.handle_resolver_refresh_failed", {
          profile_id: profile.profile_id,
          error: msg,
        });
      });

      return accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("oauth.refresh_failed", {
        provider: profile.provider,
        profile_id: profile.profile_id,
        error: msg,
      });
      const createdHandles = [createdAccessHandleId, createdRefreshHandleId].filter(
        (v): v is string => Boolean(v),
      );
      if (createdHandles.length > 0) {
        if (!updateAttempted) {
          await Promise.all(
            createdHandles.map((handleId) => secretProvider.revoke(handleId).catch(() => {})),
          );
        } else {
          const latest = await authProfileDal.getById(profile.profile_id).catch(() => undefined);
          const referenced = new Set(Object.values(latest?.secret_handles ?? {}));
          await Promise.all(
            createdHandles
              .filter((handleId) => !referenced.has(handleId))
              .map((handleId) => secretProvider.revoke(handleId).catch(() => {})),
          );
        }
      }
      // If refresh fails and the token is already expired, avoid hammering the token endpoint.
      if (force || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        await authProfileDal.setCooldown(profile.profile_id, { untilMs: Date.now() + 60_000 });
      }
      return null;
    } finally {
      await oauthRefreshLeaseDal
        .release({ profileId: profile.profile_id, owner: oauthLeaseOwner })
        .catch(() => {});
    }
  }

  const refreshed = await maybeRefreshOAuthAccessToken({ force: opts?.forceOAuthRefresh ?? false });
  if (refreshed) return refreshed;

  if (profile.type === "oauth") {
    const refreshTokenHandleId = profile.secret_handles?.["refresh_token_handle"];
    if (refreshTokenHandleId) {
      const expiresAt = profile.expires_at;
      const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        return null;
      }
    }
  }

  const handles = profile.secret_handles ?? {};
  const handleId =
    profile.type === "api_key"
      ? handles["api_key_handle"]
      : profile.type === "token"
        ? handles["token_handle"]
        : handles["access_token_handle"];
  if (!handleId || !resolver) return null;
  return await resolver.resolveById(handleId);
}
