import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestContainer } from "./helpers.js";
import { createApp } from "../../src/app.js";
import { FileSecretProvider } from "../../src/modules/secret/provider.js";

describe("secret rotation/revocation propagation (integration)", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-auth-profile-propagation-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function setup() {
    const container = await createTestContainer();
    const secretProvider = await FileSecretProvider.create(
      secretsPath,
      "test-admin-token-for-testing",
    );
    const app = createApp(container, {
      secretProvider,
      isLocalOnly: true,
      runtime: {
        version: "test",
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
    });
    return { app, container, secretProvider };
  }

  it("rotating a secret updates auth profiles that reference it", async () => {
    const { app, secretProvider } = await setup();

    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "OPENAI_API_KEY", value: "v1" }),
    });
    expect(storeRes.status).toBe(201);
    const { handle: oldHandle } = (await storeRes.json()) as {
      handle: { handle_id: string; scope: string };
    };

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        type: "api_key",
        secret_handles: { api_key_handle: oldHandle.handle_id },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { profile: { profile_id: string } };

    const rotateRes = await app.request(`/secrets/${oldHandle.handle_id}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    expect(rotateRes.status).toBe(201);
    const rotateBody = (await rotateRes.json()) as { handle: { handle_id: string; scope: string } };

    const listRes = await app.request("/auth/profiles");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      profiles: Array<{
        profile_id: string;
        secret_handles: Record<string, string>;
        status: string;
      }>;
    };
    const updated = listed.profiles.find((p) => p.profile_id === created.profile.profile_id);
    expect(updated).toBeTruthy();
    expect(updated!.status).toBe("active");
    expect(updated!.secret_handles["api_key_handle"]).toBe(rotateBody.handle.handle_id);

    const resolved = await secretProvider.resolve({
      handle_id: rotateBody.handle.handle_id,
      provider: "file",
      scope: oldHandle.scope,
      created_at: new Date().toISOString(),
    });
    expect(resolved).toBe("v2");
  });

  it("revoking a secret disables auth profiles that reference it", async () => {
    const { app } = await setup();

    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "OPENAI_API_KEY", value: "v1" }),
    });
    expect(storeRes.status).toBe(201);
    const { handle } = (await storeRes.json()) as { handle: { handle_id: string } };

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        type: "api_key",
        secret_handles: { api_key_handle: handle.handle_id },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { profile: { profile_id: string } };

    const revokeRes = await app.request(`/secrets/${handle.handle_id}`, {
      method: "DELETE",
    });
    expect(revokeRes.status).toBe(200);

    const listRes = await app.request("/auth/profiles");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      profiles: Array<{ profile_id: string; status: string; disabled_reason?: string | null }>;
    };
    const updated = listed.profiles.find((p) => p.profile_id === created.profile.profile_id);
    expect(updated).toBeTruthy();
    expect(updated!.status).toBe("disabled");
    expect(updated!.disabled_reason).toBe("secret_handle_revoked");
  });
});
