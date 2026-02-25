import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createSecretRoutes } from "../../src/routes/secret.js";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { AuthProfileDal, AuthProfileRow } from "../../src/modules/models/auth-profile-dal.js";
import { Logger } from "../../src/modules/observability/logger.js";

class TrackingSecretProvider implements SecretProvider {
  revokedHandleIds: string[] = [];

  async resolve(_handle: SecretHandle): Promise<string | null> {
    return null;
  }

  async store(_scope: string, _value: string): Promise<SecretHandle> {
    return {
      handle_id: randomUUID(),
      provider: "file",
      scope: "SCOPE",
      created_at: new Date().toISOString(),
    };
  }

  async revoke(handleId: string): Promise<boolean> {
    this.revokedHandleIds.push(handleId);
    return true;
  }

  async list(): Promise<SecretHandle[]> {
    return [];
  }
}

describe("secret revoke disable failure handling (integration)", () => {
  it("does not fail the request when auth profile disabling fails after revocation", async () => {
    const secretProvider = new TrackingSecretProvider();
    const handleId = "h-1";

    let disableCalls = 0;
    const authProfileDal = {
      async listByAgentAfter(): Promise<AuthProfileRow[]> {
        return [
          {
            profile_id: "p-1",
            agent_id: "default",
            provider: "openai",
            type: "api_key",
            secret_handles: { api_key_handle: handleId },
            labels: {},
            status: "active",
            disabled_reason: null,
            disabled_at: null,
            cooldown_until_ms: null,
            expires_at: null,
            created_by: null,
            updated_by: null,
            created_at: "2026-02-19T12:00:00Z",
            updated_at: "2026-02-19T12:00:00Z",
          },
        ];
      },
      async disableProfile(): Promise<void> {
        disableCalls += 1;
        throw new Error("db write failed");
      },
    } as unknown as AuthProfileDal;

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => secretProvider,
        authProfileDal,
        logger: new Logger({ level: "silent" }),
      }),
    );

    const res = await app.request(`/secrets/${handleId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(secretProvider.revokedHandleIds).toEqual([handleId]);
    expect(disableCalls).toBe(1);
  });
});
