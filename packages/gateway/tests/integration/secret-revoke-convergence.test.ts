import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createTestContainer } from "./helpers.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

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
  it("returns 404 for missing secrets without mutating auth profiles", async () => {
    const container = await createTestContainer();
    const authProfileDal = new AuthProfileDal(container.db);

    const missingHandleId = "missing-handle";
    const authProfileKey = "profile-missing-secret";
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey,
      providerKey: "openai",
      type: "api_key",
      labels: { source: "test" },
    });

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => new AlwaysNotFoundSecretProvider(),
      }),
    );

    const res = await app.request(`/secrets/${missingHandleId}`, { method: "DELETE" });
    expect(res.status).toBe(404);

    const updated = await authProfileDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey,
    });
    expect(updated?.status).toBe("active");
  });
});
