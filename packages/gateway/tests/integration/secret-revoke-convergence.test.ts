import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createTestContainer } from "./helpers.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { createSecretRoutes } from "../../src/routes/secret.js";

class AlwaysNotFoundSecretProvider implements SecretProvider {
  async resolve(_handle: SecretHandle): Promise<string | null> {
    return null;
  }

  async store(scope: string, _value: string): Promise<SecretHandle> {
    return {
      handle_id: randomUUID(),
      provider: "file",
      scope,
      created_at: new Date().toISOString(),
    };
  }

  async revoke(_handleId: string): Promise<boolean> {
    return false;
  }

  async list(): Promise<SecretHandle[]> {
    return [];
  }
}

describe("secret revoke convergence (integration)", () => {
  it("disables auth profiles referencing the handle even if the secret is already gone", async () => {
    const container = await createTestContainer();
    const authProfileDal = new AuthProfileDal(container.db);

    const missingHandleId = "missing-handle";
    const profileId = randomUUID();
    await authProfileDal.create({
      profileId,
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: missingHandleId },
    });

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => new AlwaysNotFoundSecretProvider(),
        authProfileDal,
      }),
    );

    const res = await app.request(`/secrets/${missingHandleId}`, { method: "DELETE" });
    expect(res.status).toBe(404);

    const updated = await authProfileDal.getById(profileId);
    expect(updated?.status).toBe("disabled");
    expect(updated?.disabled_reason).toBe("secret_handle_revoked");
  });
});

