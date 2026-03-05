import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { createDbSecretProviderFactory } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";

describe("provider OAuth routes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-oauth-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedProviderConfig(input: {
    container: Awaited<ReturnType<typeof createTestContainer>>;
    providerId: string;
    clientId: string;
    clientSecretKey?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    issuer?: string;
  }) {
    const nowIso = new Date().toISOString();
    await input.container.db.run(
      `INSERT INTO oauth_provider_configs (
         tenant_id,
         provider_id,
         display_name,
         issuer,
         authorization_endpoint,
         token_endpoint,
         device_authorization_endpoint,
         scopes_json,
         client_id,
         client_secret_key,
         token_endpoint_basic_auth,
         extra_authorize_params_json,
         extra_token_params_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, '["scope1"]', ?, ?, 0, '{}', '{}', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        input.providerId,
        "Test Provider",
        input.issuer ?? null,
        input.authorizationEndpoint ?? null,
        input.tokenEndpoint ?? null,
        input.clientId,
        input.clientSecretKey ?? null,
        nowIso,
        nowIso,
      ],
    );
  }

  async function createOauthApp() {
    const container = await createTestContainer({ tyrumHome: tempDir });
    const secrets = await createDbSecretProviderFactory({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: tempDir,
    });
    const secretProviderForTenant = secrets.secretProviderForTenant;
    const authTokens = new AuthTokenService(container.db);
    const tenantAdminToken = (
      await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
    ).token;

    const app = createApp(container, {
      authTokens,
      secretProviderForTenant,
      isLocalOnly: true,
      runtime: {
        version: "test",
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
    });

    return { app, container, secretProviderForTenant, tenantAdminToken };
  }

  it("completes auth-code OAuth and creates an auth profile (callback is public)", async () => {
    const { app, container, secretProviderForTenant, tenantAdminToken } = await createOauthApp();

    const secretProvider = secretProviderForTenant(DEFAULT_TENANT_ID);
    await secretProvider.store("oauth.test.client_secret", "secret-1", { createOnly: true });

    await seedProviderConfig({
      container,
      providerId: "test",
      clientId: "client-1",
      clientSecretKey: "oauth.test.client_secret",
      authorizationEndpoint: "https://auth.test/authorize",
      tokenEndpoint: "https://auth.test/token",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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
      }),
    );

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${tenantAdminToken}`,
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

    const secrets = await container.db.all<{ secret_key: string }>(
      `SELECT secret_key FROM secrets WHERE tenant_id = ? ORDER BY secret_key ASC`,
      [DEFAULT_TENANT_ID],
    );
    expect(secrets.map((row) => row.secret_key)).toContain("oauth.test.client_secret");

    await container.db.close();
  });

  it("does not require OIDC discovery on callback when token endpoint is explicit", async () => {
    const { app, container, secretProviderForTenant, tenantAdminToken } = await createOauthApp();

    const secretProvider = secretProviderForTenant(DEFAULT_TENANT_ID);
    await secretProvider.store("oauth.test.client_secret", "secret-1", { createOnly: true });

    await seedProviderConfig({
      container,
      providerId: "test",
      clientId: "client-1",
      clientSecretKey: "oauth.test.client_secret",
      issuer: "https://issuer.test",
      tokenEndpoint: "https://auth.test/token",
    });

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

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${tenantAdminToken}`,
      },
      body: JSON.stringify({ agent_key: "default" }),
    });
    expect(authorizeRes.status).toBe(200);
    const authorize = (await authorizeRes.json()) as { state: string; authorize_url: string };
    expect(authorize.authorize_url).toContain("https://auth.test/authorize");

    const callbackRes = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(authorize.state)}&code=code-1`,
    );
    expect(callbackRes.status).toBe(200);
    expect(discoveryCalls).toBe(1);

    await container.db.close();
  });

  it("accepts non-default agent_key when agent registry is disabled", async () => {
    const { app, container, secretProviderForTenant, tenantAdminToken } = await createOauthApp();

    const secretProvider = secretProviderForTenant(DEFAULT_TENANT_ID);
    await secretProvider.store("oauth.test.client_secret", "secret-1", { createOnly: true });

    await seedProviderConfig({
      container,
      providerId: "test",
      clientId: "client-1",
      clientSecretKey: "oauth.test.client_secret",
      authorizationEndpoint: "https://auth.test/authorize",
      tokenEndpoint: "https://auth.test/token",
    });

    const authorizeRes = await app.request("/providers/test/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${tenantAdminToken}`,
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
