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

describe("secret rotation pagination (integration)", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-rotation-pagination-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates auth profiles beyond the first 500", async () => {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(
      secretsPath,
      "test-admin-token-for-testing",
    );
    const authProfileDal = new AuthProfileDal(container.db);

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForAgent: async () => secretProvider,
        authProfileDal,
      }),
    );

    const oldHandle = await secretProvider.store("OPENAI_API_KEY", "v1");

    const profileCount = 501;
    for (let i = 0; i < profileCount; i += 1) {
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
    expect(rotateRes.status).toBe(201);
    const rotateBody = (await rotateRes.json()) as { handle: { handle_id: string } };

    const rows = await container.db.all<{ secret_handles_json: unknown }>(
      "SELECT secret_handles_json FROM auth_profiles WHERE agent_id = ?",
      ["default"],
    );
    expect(rows).toHaveLength(profileCount);

    const expectedHandleId = rotateBody.handle.handle_id;
    const stale = rows.filter((r) => {
      const raw = r.secret_handles_json;
      const parsed =
        typeof raw === "string"
          ? (JSON.parse(raw) as Record<string, unknown>)
          : (raw as Record<string, unknown>);
      return parsed["api_key_handle"] !== expectedHandleId;
    });
    expect(stale).toHaveLength(0);

    const oldResolved = await secretProvider.resolve(oldHandle);
    expect(oldResolved).toBeNull();
  });
});
