import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createSecretRoutes } from "../../src/routes/secret.js";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";

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
  it("does not fail revoke when legacy auth-profile disable hooks are present", async () => {
    const secretProvider = new TrackingSecretProvider();
    const handleId = "h-1";

    let legacyHookCalls = 0;
    const routeDeps = {
      secretProviderForAgent: async () => secretProvider,
      authProfileDal: {
        async listByAgentAfter(): Promise<unknown[]> {
          legacyHookCalls += 1;
          return [];
        },
        async disableProfile(): Promise<void> {
          legacyHookCalls += 1;
          throw new Error("db write failed");
        },
      },
    } as unknown as Parameters<typeof createSecretRoutes>[0];

    const app = new Hono();
    app.route("/", createSecretRoutes(routeDeps));

    const res = await app.request(`/secrets/${handleId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(secretProvider.revokedHandleIds).toEqual([handleId]);
    expect(legacyHookCalls).toBe(0);
  });
});
