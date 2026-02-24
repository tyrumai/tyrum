import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createTestContainer } from "./helpers.js";
import { FileSecretProvider } from "../../src/modules/secret/provider.js";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";

class FailingAuthProfileDal extends AuthProfileDal {
  override async updateSecretHandles(): Promise<undefined> {
    throw new Error("simulated auth profile update failure");
  }
}

describe("secret rotation atomicity (integration)", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-rotation-atomicity-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not revoke the old handle when auth-profile propagation fails", async () => {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(secretsPath, "test-admin-token-for-testing");
    const authProfileDal = new FailingAuthProfileDal(container.db);

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => secretProvider,
        authProfileDal,
      }),
    );

    const oldHandle = await secretProvider.store("OPENAI_API_KEY", "v1");
    await authProfileDal.create({
      profileId: randomUUID(),
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

    const stillResolves = await secretProvider.resolve(oldHandle);
    expect(stillResolves).toBe("v1");
  });
});

