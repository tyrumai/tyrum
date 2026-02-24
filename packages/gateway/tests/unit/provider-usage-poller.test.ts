import { describe, expect, it } from "vitest";
import { ProviderUsagePoller } from "../../src/modules/observability/provider-usage.js";
import type { AuthProfileDal, AuthProfileRow } from "../../src/modules/models/auth-profile-dal.js";
import type { SessionProviderPinDal, SessionProviderPinRow } from "../../src/modules/models/session-pin-dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";

describe("ProviderUsagePoller", () => {
  it("returns a structured error when the secret provider throws", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const profile: AuthProfileRow = {
        profile_id: "profile-1",
        agent_id: "default",
        provider: "openrouter",
        type: "api_key",
        secret_handles: { api_key_handle: "handle-1" },
        labels: {},
        status: "active",
        disabled_reason: null,
        disabled_at: null,
        cooldown_until_ms: null,
        expires_at: null,
        created_by: null,
        updated_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const pin: SessionProviderPinRow = {
        agent_id: "default",
        session_id: "session-1",
        provider: "openrouter",
        profile_id: profile.profile_id,
        pinned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const authProfileDal = {
        async getById() {
          return profile;
        },
      } as unknown as AuthProfileDal;

      const pinDal = {
        async list() {
          return [pin];
        },
      } as unknown as SessionProviderPinDal;

      const agents = {
        async getSecretProvider() {
          throw new Error("secret backend down");
        },
      } as unknown as AgentRegistry;

      const poller = new ProviderUsagePoller({ authProfileDal, pinDal, agents });

      await expect(poller.pollLatestPinned()).resolves.toMatchObject({
        status: "error",
        provider: "openrouter",
        profile_id: profile.profile_id,
        error: { code: "secret_resolution_failed" },
      });
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });
});

