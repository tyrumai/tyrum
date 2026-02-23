import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";

class MemorySecretProvider implements SecretProvider {
  private byId = new Map<string, { handle: SecretHandle; value: string }>();

  async resolve(handle: SecretHandle): Promise<string | null> {
    return this.byId.get(handle.handle_id)?.value ?? null;
  }

  async store(scope: string, value: string): Promise<SecretHandle> {
    const handle: SecretHandle = {
      handle_id: randomUUID(),
      provider: "file",
      scope,
      created_at: new Date().toISOString(),
    };
    this.byId.set(handle.handle_id, { handle, value });
    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    return this.byId.delete(handleId);
  }

  async list(): Promise<SecretHandle[]> {
    return [...this.byId.values()].map((x) => x.handle);
  }
}

describe("provider OAuth routes", () => {
  let tempDir: string;
  let tokenStore: TokenStore;
  let adminToken: string;
  let secretProvider: MemorySecretProvider;
  let oauthConfigPath: string;

  const prevOauthConfigEnv = process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];
  const prevClientId = process.env["TEST_CLIENT_ID"];
  const prevClientSecret = process.env["TEST_CLIENT_SECRET"];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-oauth-test-"));
    tokenStore = new TokenStore(tempDir);
    adminToken = await tokenStore.initialize();

    oauthConfigPath = join(tempDir, "oauth-providers.yml");
    await writeFile(
      oauthConfigPath,
      [
        "providers:",
        "  - provider_id: test",
        "    display_name: Test Provider",
        "    authorization_endpoint: https://auth.test/authorize",
        "    token_endpoint: https://auth.test/token",
        "    scopes: [scope1]",
        "    client_id_env: TEST_CLIENT_ID",
        "    client_secret_env: TEST_CLIENT_SECRET",
        "    token_endpoint_basic_auth: false",
      ].join("\n"),
      "utf-8",
    );

    process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"] = oauthConfigPath;
    process.env["TEST_CLIENT_ID"] = "client-1";
    process.env["TEST_CLIENT_SECRET"] = "secret-1";

    secretProvider = new MemorySecretProvider();

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const resolved = typeof url === "string" ? url : url.toString();
      if (resolved === "https://auth.test/token") {
        const body = typeof init?.body === "string" ? init.body : "";
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=code-1");
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (prevOauthConfigEnv === undefined) delete process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];
    else process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"] = prevOauthConfigEnv;

    if (prevClientId === undefined) delete process.env["TEST_CLIENT_ID"];
    else process.env["TEST_CLIENT_ID"] = prevClientId;

    if (prevClientSecret === undefined) delete process.env["TEST_CLIENT_SECRET"];
    else process.env["TEST_CLIENT_SECRET"] = prevClientSecret;

    await rm(tempDir, { recursive: true, force: true });
  });

  it("completes auth-code OAuth and creates an auth profile (callback is public)", async () => {
    const container = await createTestContainer();
    const app = createApp(container, {
      tokenStore,
      secretProvider,
      isLocalOnly: true,
      runtime: {
        version: "test",
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
    });

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_id: "default" }),
    });
    expect(authorizeRes.status).toBe(200);
    const authorize = (await authorizeRes.json()) as { state: string; authorize_url: string };
    expect(authorize.state).toBeTypeOf("string");
    expect(authorize.authorize_url).toContain("https://auth.test/authorize");

    // Callback does not include Authorization header.
    const callbackRes = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(authorize.state)}&code=code-1`,
    );
    expect(callbackRes.status).toBe(200);

    const authProfileDal = new AuthProfileDal(container.db);
    const profiles = await authProfileDal.list({ provider: "test" });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.type).toBe("oauth");
    expect(profiles[0]!.secret_handles["access_token_handle"]).toBeTypeOf("string");
    expect(profiles[0]!.secret_handles["refresh_token_handle"]).toBeTypeOf("string");

    const handles = await secretProvider.list();
    expect(handles.length).toBeGreaterThan(0);

    await container.db.close();
  });

  it("rejects non-default agent_id when agent registry is disabled", async () => {
    const container = await createTestContainer();
    const app = createApp(container, {
      tokenStore,
      secretProvider,
      isLocalOnly: true,
      runtime: {
        version: "test",
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
    });

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_id: "agent-2" }),
    });
    expect(authorizeRes.status).toBe(400);
    const body = (await authorizeRes.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("non-default agent_id");

    await container.db.close();
  });
});
