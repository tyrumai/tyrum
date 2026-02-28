import { describe, expect, it, vi } from "vitest";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { createSecretRoutes } from "../../src/routes/secret.js";

describe("Secret routes", () => {
  it("logs when cleanup revoke fails after auth profile rotation errors", async () => {
    const logger = { warn: vi.fn() } as any;

    const existingHandleId = "handle-1";
    const existingHandle: SecretHandle = {
      handle_id: existingHandleId,
      provider: "file",
      scope: "scope-1",
      created_at: new Date().toISOString(),
    };
    const createdHandle: SecretHandle = {
      handle_id: "handle-2",
      provider: "file",
      scope: "scope-1",
      created_at: new Date().toISOString(),
    };

    const secretProvider = {
      list: vi.fn(async () => [existingHandle]),
      store: vi.fn(async () => createdHandle),
      revoke: vi.fn(async (handleId: string) => {
        if (handleId === createdHandle.handle_id) {
          throw new Error("revoke failed");
        }
        return true;
      }),
    } as unknown as SecretProvider;

    const authProfileDal = {
      listByAgentAfter: vi.fn(async () => {
        throw new Error("db down");
      }),
    } as unknown as AuthProfileDal;

    const app = createSecretRoutes({
      secretProviderForAgent: async () => secretProvider,
      authProfileDal,
      logger,
    });

    const res = await app.request(`/secrets/${existingHandleId}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "new-value" }),
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
    expect(logger.warn).toHaveBeenCalledWith(
      "secret.rotate.cleanup_revoke_failed",
      expect.objectContaining({
        handle_id: createdHandle.handle_id,
        error: "revoke failed",
      }),
    );
  });
});
