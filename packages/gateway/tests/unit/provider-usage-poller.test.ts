import { describe, expect, it, vi } from "vitest";
import { ProviderUsagePoller } from "../../src/modules/observability/provider-usage.js";
import type { AuthProfileDal, AuthProfileRow } from "../../src/modules/models/auth-profile-dal.js";
import type {
  ConversationProviderPinDal,
  ConversationProviderPinRow,
} from "../../src/modules/models/conversation-pin-dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("ProviderUsagePoller", () => {
  it("returns a structured error when the secret provider throws", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const profile: AuthProfileRow = {
        tenant_id: DEFAULT_TENANT_ID,
        auth_profile_id: "00000000-0000-4000-8000-000000000201",
        auth_profile_key: "profile-1",
        provider_key: "openrouter",
        type: "api_key",
        status: "active",
        secret_keys: { api_key: "secret-1" },
        labels: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const pin: ConversationProviderPinRow = {
        tenant_id: DEFAULT_TENANT_ID,
        conversation_id: "conversation-1",
        provider_key: "openrouter",
        auth_profile_id: profile.auth_profile_id,
        auth_profile_key: profile.auth_profile_key,
        pinned_at: new Date().toISOString(),
      };

      const authProfileDal = {
        async getByKey() {
          return profile;
        },
      } as unknown as AuthProfileDal;

      const pinDal = {
        async list() {
          return [pin];
        },
      } as unknown as ConversationProviderPinDal;

      const secretProvider = {
        async resolve() {
          throw new Error("secret backend down");
        },
      } as unknown as SecretProvider;

      const poller = new ProviderUsagePoller({
        tenantId: DEFAULT_TENANT_ID,
        authProfileDal,
        pinDal,
        secretProvider,
      });

      await expect(poller.pollLatestPinned()).resolves.toMatchObject({
        status: "error",
        provider_key: "openrouter",
        auth_profile_key: profile.auth_profile_key,
        error: {
          code: "secret_resolution_failed",
          message: "Auth profile credential could not be resolved from the secret provider.",
          detail: "secret backend down",
          retryable: true,
        },
      });
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("does not immediately expire cached errors after a slow poll", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const profile: AuthProfileRow = {
        tenant_id: DEFAULT_TENANT_ID,
        auth_profile_id: "00000000-0000-4000-8000-000000000211",
        auth_profile_key: "profile-slow-1",
        provider_key: "openrouter",
        type: "api_key",
        status: "active",
        secret_keys: { api_key: "secret-slow-1" },
        labels: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const pin: ConversationProviderPinRow = {
        tenant_id: DEFAULT_TENANT_ID,
        conversation_id: "conversation-slow-1",
        provider_key: "openrouter",
        auth_profile_id: profile.auth_profile_id,
        auth_profile_key: profile.auth_profile_key,
        pinned_at: new Date().toISOString(),
      };

      const authProfileDal = {
        async getByKey() {
          return profile;
        },
      } as unknown as AuthProfileDal;

      const pinDal = {
        async list() {
          return [pin];
        },
      } as unknown as ConversationProviderPinDal;

      const secretProvider = {
        async resolve() {
          return "test-token";
        },
      } as unknown as SecretProvider;

      const fetchMock = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        return new Response("rate limited", {
          status: 429,
          headers: { "content-type": "text/plain" },
        });
      });

      const poller = new ProviderUsagePoller({
        tenantId: DEFAULT_TENANT_ID,
        authProfileDal,
        pinDal,
        secretProvider,
        fetchImpl: fetchMock as unknown as typeof fetch,
        errorCacheTtlMs: 1_000,
      });

      const firstPromise = poller.pollLatestPinned();
      await vi.advanceTimersByTimeAsync(2_000);
      const first = await firstPromise;
      expect(first).toMatchObject({ status: "error", cached: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const secondPromise = poller.pollLatestPinned();
      await vi.advanceTimersByTimeAsync(2_000);
      const second = await secondPromise;
      expect(second).toMatchObject({ status: "error", cached: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
      vi.useRealTimers();
    }
  });

  it("returns a structured result when pin listing throws", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const authProfileDal = {} as unknown as AuthProfileDal;
      const pinDal = {
        async list() {
          throw new Error("db down");
        },
      } as unknown as ConversationProviderPinDal;

      const secretProvider = {
        async resolve() {
          return "token";
        },
      } as unknown as SecretProvider;

      const poller = new ProviderUsagePoller({
        tenantId: DEFAULT_TENANT_ID,
        authProfileDal,
        pinDal,
        secretProvider,
      });

      await expect(poller.pollLatestPinned()).resolves.toMatchObject({
        status: "unavailable",
        error: { code: "pin_list_failed", retryable: true },
      });
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("returns a structured result when auth profile lookup throws", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const pin: ConversationProviderPinRow = {
        tenant_id: DEFAULT_TENANT_ID,
        conversation_id: "conversation-1",
        provider_key: "openrouter",
        auth_profile_id: "00000000-0000-4000-8000-000000000222",
        auth_profile_key: "profile-1",
        pinned_at: new Date().toISOString(),
      };

      const authProfileDal = {
        async getByKey() {
          throw new Error("db down");
        },
      } as unknown as AuthProfileDal;

      const pinDal = {
        async list() {
          return [pin];
        },
      } as unknown as ConversationProviderPinDal;

      const secretProvider = {
        async resolve() {
          return "token";
        },
      } as unknown as SecretProvider;

      const poller = new ProviderUsagePoller({
        tenantId: DEFAULT_TENANT_ID,
        authProfileDal,
        pinDal,
        secretProvider,
      });

      await expect(poller.pollLatestPinned()).resolves.toMatchObject({
        status: "error",
        provider_key: "openrouter",
        auth_profile_key: "profile-1",
        error: { code: "auth_profile_lookup_failed", retryable: true },
      });
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });
});
