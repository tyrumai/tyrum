import type { AgentRegistry } from "../agent/registry.js";
import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import type { AuthProfileDal, AuthProfileRow } from "../models/auth-profile-dal.js";
import type { SessionProviderPinDal, SessionProviderPinRow } from "../models/session-pin-dal.js";
import { createSecretHandleResolver } from "../secret/handle-resolver.js";
import { safeDetail } from "../../utils/safe-detail.js";
import type { Logger } from "./logger.js";

export type ProviderUsageError = {
  code: string;
  message: string;
  detail?: string;
  retryable: boolean;
};

export type ProviderUsageResult =
  | {
      status: "ok";
      provider: string;
      profile_id: string;
      cached: boolean;
      polled_at: string;
      data: unknown;
    }
  | {
      status: "error";
      provider: string | null;
      profile_id: string | null;
      cached: boolean;
      polled_at: string | null;
      error: ProviderUsageError;
    }
  | {
      status: "unavailable";
      cached: boolean;
      polled_at: string | null;
      error: ProviderUsageError;
    };

function pickAuthHandleId(profile: AuthProfileRow): string | undefined {
  const handles = profile.secret_handles ?? {};
  if (profile.type === "api_key") return handles["api_key_handle"];
  if (profile.type === "token") return handles["token_handle"];
  return handles["access_token_handle"];
}

function withCached(result: ProviderUsageResult, cached: boolean): ProviderUsageResult {
  if (result.status === "ok") return { ...result, cached };
  if (result.status === "error") return { ...result, cached };
  return { ...result, cached };
}

function toError(err: unknown, fallback: ProviderUsageError): ProviderUsageError {
  const detail = fallback.detail ?? safeDetail(err);
  if (detail) return { ...fallback, detail };
  return fallback;
}

function isProviderUsageError(value: unknown): value is ProviderUsageError {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<ProviderUsageError>;
  return (
    typeof maybe.code === "string" &&
    typeof maybe.message === "string" &&
    typeof maybe.retryable === "boolean"
  );
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

type CacheEntry = { expires_at_ms: number; result: ProviderUsageResult };

export class ProviderUsagePoller {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly deps: {
      authProfileDal?: AuthProfileDal;
      pinDal?: SessionProviderPinDal;
      agents?: AgentRegistry;
      logger?: Logger;
      fetchImpl?: typeof fetch;
      cacheTtlMs?: number;
      errorCacheTtlMs?: number;
    },
  ) {}

  async pollLatestPinned(): Promise<ProviderUsageResult> {
    if (!isAuthProfilesEnabled()) {
      return {
        status: "unavailable",
        cached: false,
        polled_at: null,
        error: {
          code: "auth_profiles_disabled",
          message: "Auth profiles are disabled.",
          retryable: false,
        },
      };
    }

    if (!this.deps.pinDal || !this.deps.authProfileDal) {
      return {
        status: "unavailable",
        cached: false,
        polled_at: null,
        error: {
          code: "usage_polling_unavailable",
          message: "Provider usage polling is unavailable on this gateway instance.",
          retryable: false,
        },
      };
    }

    let pins: SessionProviderPinRow[] = [];
    try {
      pins = await this.deps.pinDal.list({ limit: 1 });
    } catch (err) {
      const error: ProviderUsageError = {
        code: "pin_list_failed",
        message: "Failed to load pinned provider profiles.",
        detail: safeDetail(err),
        retryable: true,
      };
      this.deps.logger?.warn("usage.pin_list_failed", {
        code: error.code,
        error: error.detail ?? error.message,
      });
      return {
        status: "unavailable",
        cached: false,
        polled_at: null,
        error,
      };
    }
    const pin = pins[0];
    if (!pin) {
      return {
        status: "unavailable",
        cached: false,
        polled_at: null,
        error: {
          code: "no_pinned_profile",
          message: "No provider auth profile is pinned yet.",
          retryable: false,
        },
      };
    }

    const provider = pin.provider.trim();
    const profileId = pin.profile_id.trim();
    const cacheKey = `${provider}\u0000${profileId}`;
    const nowMs = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires_at_ms > nowMs) {
      return withCached(cached.result, true);
    }

    const cacheTtlMs = Math.max(1_000, this.deps.cacheTtlMs ?? 60_000);
    const errorCacheTtlMs = Math.max(1_000, this.deps.errorCacheTtlMs ?? 10_000);

    const result = await this.pollProviderUsage({ provider, profileId, agentId: pin.agent_id });
    const ttlMs = result.status === "ok" ? cacheTtlMs : errorCacheTtlMs;
    const storedAtMs = Date.now();
    const baseMs = storedAtMs >= nowMs ? storedAtMs : nowMs;
    this.cache.set(cacheKey, { expires_at_ms: baseMs + ttlMs, result });
    return result;
  }

  private async pollProviderUsage(input: {
    provider: string;
    profileId: string;
    agentId: string;
  }): Promise<ProviderUsageResult> {
    const { provider, profileId, agentId } = input;

    const nowIso = new Date().toISOString();

    let profile: AuthProfileRow | undefined;
    try {
      profile = await this.deps.authProfileDal?.getById(profileId);
    } catch (err) {
      const error: ProviderUsageError = {
        code: "auth_profile_lookup_failed",
        message: "Failed to load pinned auth profile.",
        detail: safeDetail(err),
        retryable: true,
      };
      this.deps.logger?.warn("usage.auth_profile_lookup_failed", {
        provider,
        profile_id: profileId,
        code: error.code,
        error: error.detail ?? error.message,
      });
      return {
        status: "error",
        provider,
        profile_id: profileId,
        cached: false,
        polled_at: nowIso,
        error,
      };
    }
    if (!profile) {
      return {
        status: "error",
        provider,
        profile_id: profileId,
        cached: false,
        polled_at: null,
        error: {
          code: "auth_profile_not_found",
          message: "Pinned auth profile not found.",
          retryable: false,
        },
      };
    }

    if (profile.status === "disabled") {
      return {
        status: "error",
        provider: profile.provider,
        profile_id: profile.profile_id,
        cached: false,
        polled_at: null,
        error: {
          code: "auth_profile_disabled",
          message: "Pinned auth profile is disabled.",
          detail: profile.disabled_reason ?? undefined,
          retryable: false,
        },
      };
    }

    const handleId = pickAuthHandleId(profile);
    if (!handleId) {
      return {
        status: "error",
        provider: profile.provider,
        profile_id: profile.profile_id,
        cached: false,
        polled_at: null,
        error: {
          code: "credential_missing",
          message: "Auth profile is missing credential handles.",
          retryable: false,
        },
      };
    }

    if (!this.deps.agents) {
      return {
        status: "error",
        provider: profile.provider,
        profile_id: profile.profile_id,
        cached: false,
        polled_at: null,
        error: {
          code: "secret_provider_unavailable",
          message: "Secret provider is unavailable on this gateway instance.",
          retryable: false,
        },
      };
    }

    let token: string | null = null;
    try {
      const secretProvider = await this.deps.agents.getSecretProvider(agentId);
      const resolver = createSecretHandleResolver(secretProvider);
      token = await resolver.resolveById(handleId);
    } catch (err) {
      const error = toError(err, {
        code: "secret_resolution_failed",
        message: "Auth profile credential could not be resolved from the secret provider.",
        retryable: true,
      });
      this.deps.logger?.warn("usage.secret_resolution_failed", {
        provider,
        profile_id: profileId,
        code: error.code,
        error: error.detail ?? error.message,
      });
      return {
        status: "error",
        provider,
        profile_id: profileId,
        cached: false,
        polled_at: nowIso,
        error,
      };
    }
    if (!token) {
      return {
        status: "error",
        provider: profile.provider,
        profile_id: profile.profile_id,
        cached: false,
        polled_at: null,
        error: {
          code: "credential_unresolved",
          message: "Auth profile credential could not be resolved from the secret provider.",
          retryable: false,
        },
      };
    }

    const fetchImpl = this.deps.fetchImpl ?? fetch;

    if (provider === "openrouter") {
      try {
        const res = await this.fetchOpenRouterKeyInfo(fetchImpl, token);
        return {
          status: "ok",
          provider,
          profile_id: profileId,
          cached: false,
          polled_at: nowIso,
          data: res,
        };
      } catch (err) {
        const parsedError = isProviderUsageError(err)
          ? err
          : toError(err, {
              code: "provider_poll_failed",
              message: "Provider usage polling failed.",
              retryable: true,
            });

        this.deps.logger?.warn("usage.openrouter_poll_failed", {
          provider,
          profile_id: profileId,
          error: parsedError.detail ?? parsedError.message,
          code: parsedError.code,
        });

        return {
          status: "error",
          provider,
          profile_id: profileId,
          cached: false,
          polled_at: nowIso,
          error: parsedError,
        };
      }
    }

    return {
      status: "error",
      provider,
      profile_id: profileId,
      cached: false,
      polled_at: nowIso,
      error: {
        code: "provider_unsupported",
        message: `Provider '${provider}' does not expose a supported usage endpoint.`,
        retryable: false,
      },
    };
  }

  private async fetchOpenRouterKeyInfo(fetchImpl: typeof fetch, token: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl("https://openrouter.ai/api/v1/auth/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (err) {
      throw toError(err, {
        code: "provider_fetch_failed",
        message: "Provider usage fetch failed.",
        retryable: true,
      });
    }

    if (!res.ok) {
      let detail: string | undefined;
      try {
        const text = await res.text();
        const trimmed = text.trim();
        detail = trimmed.length > 0 ? trimmed.slice(0, 512) : undefined;
      } catch {
        detail = undefined;
      }

      throw {
        code: "provider_http_error",
        message: `Provider usage endpoint returned HTTP ${String(res.status)}.`,
        detail,
        retryable: res.status >= 500 || res.status === 429,
      } satisfies ProviderUsageError;
    }

    try {
      const json = (await res.json()) as unknown;
      const parsed = asObject(json);
      const dataObj = parsed ? asObject(parsed["data"]) : undefined;
      if (dataObj) return { kind: "openrouter", key: dataObj };
      return { kind: "openrouter", key: parsed ?? {} };
    } catch (err) {
      throw toError(err, {
        code: "provider_response_invalid",
        message: "Provider usage endpoint returned invalid JSON.",
        retryable: true,
      });
    }
  }
}
