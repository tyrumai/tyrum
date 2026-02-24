import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createTestContainer } from "./helpers.js";
import { FileSecretProvider } from "../../src/modules/secret/provider.js";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { AuthProfileDal, type AuthProfileRow } from "../../src/modules/models/auth-profile-dal.js";

class FailAfterFirstUpdateAuthProfileDal extends AuthProfileDal {
  private updateCalls = 0;

  override async updateSecretHandles(
    profileId: string,
    input: { secretHandles: Record<string, string>; expiresAt?: string | null; updatedBy?: unknown },
  ): Promise<AuthProfileRow | undefined> {
    this.updateCalls += 1;
    if (this.updateCalls > 1) {
      throw new Error("simulated auth profile update failure (second update)");
    }
    return await super.updateSecretHandles(profileId, input);
  }
}

describe("secret rotation partial propagation (integration)", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-rotation-partial-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not revoke the new handle if propagation fails after updating some profiles", async () => {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(secretsPath, "test-admin-token-for-testing");
    const authProfileDal = new FailAfterFirstUpdateAuthProfileDal(container.db);

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => secretProvider,
        authProfileDal,
      }),
    );

    const oldHandle = await secretProvider.store("OPENAI_API_KEY", "v1");
    const profileA = randomUUID();
    const profileB = randomUUID();
    await authProfileDal.create({
      profileId: profileA,
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: oldHandle.handle_id },
    });
    await authProfileDal.create({
      profileId: profileB,
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: oldHandle.handle_id },
    });

    const rotateRes = await app.request(`/secrets/${oldHandle.handle_id}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    expect(rotateRes.status).toBe(500);

    const handles = await secretProvider.list();
    const rotated = handles.find((h) => h.scope === oldHandle.scope && h.handle_id !== oldHandle.handle_id);
    expect(rotated).toBeTruthy();

    const newResolved = await secretProvider.resolve(rotated!);
    expect(newResolved).toBe("v2");

    const oldResolved = await secretProvider.resolve(oldHandle);
    expect(oldResolved).toBe("v1");

    const updatedA = await authProfileDal.getById(profileA);
    const updatedB = await authProfileDal.getById(profileB);
    const handleIds = [
      updatedA?.secret_handles["api_key_handle"],
      updatedB?.secret_handles["api_key_handle"],
    ].sort();
    expect(handleIds).toEqual([oldHandle.handle_id, rotated!.handle_id].sort());
  });
});
