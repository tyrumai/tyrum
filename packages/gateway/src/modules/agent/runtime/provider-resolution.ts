import { APICallError } from "ai";
import type { GatewayContainer } from "../../../container.js";
import { refreshAccessToken, resolveOAuthEndpoints } from "../../oauth/oauth-client.js";
import { AuthProfileDal, type AuthProfileRow } from "../../models/auth-profile-dal.js";
import { isAuthProfilesEnabled } from "../../models/auth-profiles-enabled.js";
import { SessionProviderPinDal } from "../../models/session-pin-dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";

export const OAUTH_REFRESH_LEASE_UNAVAILABLE = "__oauth_refresh_lease_unavailable__";

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
  tenantId: string;
  sessionId: string;
  providerKey: string;
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
}): Promise<AuthProfileRow[]> {
  if (!isAuthProfilesEnabled()) return [];

  const eligibleProfiles = await input.authProfileDal.list({
    tenantId: input.tenantId,
    providerKey: input.providerKey,
    status: "active",
  });

  if (eligibleProfiles.length === 0) return [];

  const pin = await input.pinDal.get({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    providerKey: input.providerKey,
  });
  const pinnedId = pin?.auth_profile_id;

  return pinnedId
    ? [...eligibleProfiles].sort((a, b) =>
        a.auth_profile_id === pinnedId ? -1 : b.auth_profile_id === pinnedId ? 1 : 0,
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
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
  oauthProviderRegistry: GatewayContainer["oauthProviderRegistry"];
  oauthRefreshLeaseDal: GatewayContainer["oauthRefreshLeaseDal"];
  logger: GatewayContainer["logger"];
  oauthLeaseOwner: string;
  fetchImpl: typeof fetch;
} {
  return {
    secretProvider: input.secretProvider,
    authProfileDal: new AuthProfileDal(input.container.db),
    pinDal: new SessionProviderPinDal(input.container.db),
    oauthProviderRegistry: input.container.oauthProviderRegistry,
    oauthRefreshLeaseDal: input.container.oauthRefreshLeaseDal,
    logger: input.container.logger,
    oauthLeaseOwner: input.oauthLeaseOwner,
    fetchImpl: input.fetchImpl,
  };
}

function buildDbHandle(secretKey: string): SecretHandle {
  const nowIso = new Date().toISOString();
  return {
    handle_id: secretKey,
    provider: "db",
    scope: secretKey,
    created_at: nowIso,
  };
}

function pickSecretKey(profile: AuthProfileRow): {
  apiKey?: string;
  refreshTokenKey?: string;
} {
  const slots = profile.secret_keys ?? {};
  const values = Object.values(slots).filter((value): value is string => typeof value === "string");
  const singleton = values.length === 1 ? values[0] : undefined;

  if (profile.type === "api_key") {
    return { apiKey: slots["api_key"] ?? singleton };
  }

  if (profile.type === "token") {
    return { apiKey: slots["token"] ?? slots["api_key"] ?? singleton };
  }

  // oauth
  return {
    apiKey: slots["access_token"] ?? singleton,
    refreshTokenKey: slots["refresh_token"],
  };
}

export async function resolveProfileApiKey(
  profile: AuthProfileRow,
  deps: {
    tenantId: string;
    secretProvider: SecretProvider | undefined;
    oauthProviderRegistry: GatewayContainer["oauthProviderRegistry"];
    oauthRefreshLeaseDal: GatewayContainer["oauthRefreshLeaseDal"];
    oauthLeaseOwner: string;
    logger: GatewayContainer["logger"];
    fetchImpl: typeof fetch;
  },
  opts?: { forceOAuthRefresh?: boolean },
): Promise<string | null> {
  if (!deps.secretProvider) return null;

  const selection = pickSecretKey(profile);
  let refreshLeaseUnavailable = false;

  const maybeRefresh = async (): Promise<string | null> => {
    if (profile.type !== "oauth") return null;
    if (!selection.apiKey || !selection.refreshTokenKey) return null;

    const nowMs = Date.now();
    const acquired = await deps.oauthRefreshLeaseDal.tryAcquire({
      tenantId: deps.tenantId,
      authProfileId: profile.auth_profile_id,
      owner: deps.oauthLeaseOwner,
      nowMs,
      leaseTtlMs: 60_000,
    });
    if (!acquired) {
      refreshLeaseUnavailable = true;
      return null;
    }

    try {
      const refreshToken = await deps.secretProvider!.resolve(
        buildDbHandle(selection.refreshTokenKey),
      );
      if (!refreshToken) return null;

      const spec = await deps.oauthProviderRegistry.get(profile.provider_key);
      if (!spec) return null;

      const clientIdEnv = spec.client_id_env?.trim();
      if (!clientIdEnv) return null;
      const clientId = process.env[clientIdEnv]?.trim();
      if (!clientId) return null;

      const clientSecretEnv = spec.client_secret_env?.trim();
      const clientSecret = clientSecretEnv ? process.env[clientSecretEnv]?.trim() : undefined;

      const { tokenEndpoint } = await resolveOAuthEndpoints(spec, {
        fetchImpl: deps.fetchImpl,
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
        fetchImpl: deps.fetchImpl,
      });

      const accessToken = token.access_token?.trim();
      if (!accessToken) return null;

      await deps.secretProvider!.store(selection.apiKey, accessToken);
      if (token.refresh_token?.trim()) {
        await deps.secretProvider!.store(selection.refreshTokenKey, token.refresh_token.trim());
      }

      return accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.warn("oauth.refresh_failed", {
        provider: profile.provider_key,
        auth_profile_id: profile.auth_profile_id,
        error: message,
      });
      return null;
    } finally {
      await deps.oauthRefreshLeaseDal
        .release({
          tenantId: deps.tenantId,
          authProfileId: profile.auth_profile_id,
          owner: deps.oauthLeaseOwner,
        })
        .catch(() => {});
    }
  };

  if (opts?.forceOAuthRefresh) {
    if (profile.type === "oauth") {
      // When we're forcing a refresh (usually after a 401/403), return only a refreshed token.
      // If refresh can't run, do not fall back to the same (likely invalid) access token.
      const refreshed = await maybeRefresh();
      if (refreshed) return refreshed;
      return refreshLeaseUnavailable ? OAUTH_REFRESH_LEASE_UNAVAILABLE : null;
    }
  }

  if (!selection.apiKey) return null;
  return await deps.secretProvider.resolve(buildDbHandle(selection.apiKey));
}
