import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("provider OAuth routes", () => {
  let tempDir: string;
  let tokenStore: TokenStore;
  let adminToken: string;
  let oauthConfigPath: string;

  const prevOauthConfigEnv = process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];
  const prevClientId = process.env["TEST_CLIENT_ID"];
  const prevClientSecret = process.env["TEST_CLIENT_SECRET"];
  const prevAuthProfilesEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];

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
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

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

    if (prevAuthProfilesEnabled === undefined) delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    else process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevAuthProfilesEnabled;

    await rm(tempDir, { recursive: true, force: true });
  });

  async function createOauthApp() {
    const container = await createTestContainer();
    const secretProvider = await createDbSecretProvider({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: tempDir,
    });
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

    return { app, container, secretProvider };
  }

  it("completes auth-code OAuth and creates an auth profile (callback is public)", async () => {
    const { app, container, secretProvider } = await createOauthApp();

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_key: "default" }),
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
    const profiles = await authProfileDal.list({
      tenantId: DEFAULT_TENANT_ID,
      providerKey: "test",
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.type).toBe("oauth");
    expect(profiles[0]!.secret_keys["access_token"]).toBeTypeOf("string");
    expect(profiles[0]!.secret_keys["refresh_token"]).toBeTypeOf("string");

    const handles = await secretProvider.list();
    expect(handles.length).toBeGreaterThan(0);

    await container.db.close();
  });

  it("does not require OIDC discovery on callback when token endpoint is explicit", async () => {
    await writeFile(
      oauthConfigPath,
      [
        "providers:",
        "  - provider_id: test",
        "    display_name: Test Provider",
        "    issuer: https://issuer.test",
        "    token_endpoint: https://auth.test/token",
        "    scopes: [scope1]",
        "    client_id_env: TEST_CLIENT_ID",
        "    client_secret_env: TEST_CLIENT_SECRET",
        "    token_endpoint_basic_auth: false",
      ].join("\n"),
      "utf-8",
    );

    let discoveryCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const resolved = typeof url === "string" ? url : url.toString();
        if (resolved === "https://issuer.test/.well-known/openid-configuration") {
          discoveryCalls += 1;
          if (discoveryCalls > 1) {
            throw new Error("discovery down");
          }
          return new Response(
            JSON.stringify({
              authorization_endpoint: "https://auth.test/authorize",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
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
      }),
    );

    const { app, container } = await createOauthApp();

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_key: "default" }),
    });
    expect(authorizeRes.status).toBe(200);
    const authorize = (await authorizeRes.json()) as { state: string; authorize_url: string };
    expect(authorize.state).toBeTypeOf("string");
    expect(authorize.authorize_url).toContain("https://auth.test/authorize");

    const callbackRes = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(authorize.state)}&code=code-1`,
    );
    expect(callbackRes.status).toBe(200);
    expect(discoveryCalls).toBe(1);

    await container.db.close();
  });

  it("does not mount provider OAuth routes when auth profiles are disabled", async () => {
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];

    const { app, container } = await createOauthApp();

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_key: "default" }),
    });
    expect(authorizeRes.status).toBe(404);

    await container.db.close();
  });

  it("accepts non-default agent_key when agent registry is disabled", async () => {
    const { app, container } = await createOauthApp();

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ agent_key: "agent-2" }),
    });
    expect(authorizeRes.status).toBe(200);
    const body = (await authorizeRes.json()) as { state: string };
    expect(body.state).toBeTypeOf("string");

    const pending = await container.oauthPendingDal.get({
      tenantId: DEFAULT_TENANT_ID,
      state: body.state,
    });
    expect(pending?.agent_key).toBe("agent-2");

    await container.db.close();
  });
});
