import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createSecretRoutes } from "../../src/routes/secret.js";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

class TrackingSecretProvider implements SecretProvider {
  revokedHandleIds: string[] = [];

  async resolve(_handle: SecretHandle): Promise<string | null> {
    return null;
  }

  async store(_scope: string, _value: string): Promise<SecretHandle> {
    return {
      handle_id: randomUUID(),
      provider: "db",
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
  it("does not fail revoke when legacy auth-profile disable hooks are present", async () => {
    const secretProvider = new TrackingSecretProvider();
    const handleId = "h-1";

    const routeDeps = {
      secretProviderForTenant: () => secretProvider,
    } as unknown as Parameters<typeof createSecretRoutes>[0];

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route("/", createSecretRoutes(routeDeps));

    const res = await app.request(`/secrets/${handleId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(secretProvider.revokedHandleIds).toEqual([handleId]);
  });
});
