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

class FailSecondPageAuthProfileDal extends AuthProfileDal {
  override async listByAgentAfter(params: {
    agentId: string;
    after?: { createdAt: string; profileId: string };
    limit?: number;
  }): Promise<AuthProfileRow[]> {
    if (params.after) {
      throw new Error("simulated paging failure");
    }
    return await super.listByAgentAfter(params);
  }
}

class FailFirstPageAuthProfileDal extends AuthProfileDal {
  override async listByAgentAfter(params: {
    agentId: string;
    after?: { createdAt: string; profileId: string };
    limit?: number;
  }): Promise<AuthProfileRow[]> {
    if (!params.after) {
      throw new Error("simulated paging failure");
    }
    return await super.listByAgentAfter(params);
  }
}

describe("secret rotation page error handling (integration)", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-rotation-page-error-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not revoke the new handle when pagination fails after some profiles were updated", async () => {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(
      secretsPath,
      "test-admin-token-for-testing",
    );
    const authProfileDal = new FailSecondPageAuthProfileDal(container.db);

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => secretProvider,
        authProfileDal,
      }),
    );

    const oldHandle = await secretProvider.store("OPENAI_API_KEY", "v1");

    const firstProfileId = randomUUID();
    await authProfileDal.create({
      profileId: firstProfileId,
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: oldHandle.handle_id },
    });

    const profileCount = 201;
    for (let i = 1; i < profileCount; i += 1) {
      await authProfileDal.create({
        profileId: randomUUID(),
        agentId: "default",
        provider: "openai",
        type: "api_key",
        secretHandles: { api_key_handle: oldHandle.handle_id },
      });
    }

    const rotateRes = await app.request(`/secrets/${oldHandle.handle_id}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    expect(rotateRes.status).toBe(500);

    const handles = await secretProvider.list();
    const rotated = handles.find(
      (h) => h.scope === oldHandle.scope && h.handle_id !== oldHandle.handle_id,
    );
    expect(rotated).toBeTruthy();

    const newResolved = await secretProvider.resolve(rotated!);
    expect(newResolved).toBe("v2");

    const oldResolved = await secretProvider.resolve(oldHandle);
    expect(oldResolved).toBe("v1");

    const firstProfile = await authProfileDal.getById(firstProfileId);
    expect(firstProfile?.secret_handles["api_key_handle"]).toBe(rotated!.handle_id);
  });

  it("revokes the new handle when pagination fails before any profiles are updated", async () => {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(
      secretsPath,
      "test-admin-token-for-testing",
    );
    const authProfileDal = new FailFirstPageAuthProfileDal(container.db);

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

    const handles = await secretProvider.list();
    const rotated = handles.find(
      (h) => h.scope === oldHandle.scope && h.handle_id !== oldHandle.handle_id,
    );
    expect(rotated).toBeFalsy();

    const oldResolved = await secretProvider.resolve(oldHandle);
    expect(oldResolved).toBe("v1");
  });
});
