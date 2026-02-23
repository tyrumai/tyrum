import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createProviderOAuthRoutes } from "../../src/routes/provider-oauth.js";
import type { OAuthProviderSpec } from "../../src/modules/oauth/provider-registry.js";
import type { OauthPendingMode, OauthPendingRow } from "../../src/modules/oauth/pending-dal.js";
import type { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";

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

class MemoryPendingDal {
  constructor(private row: OauthPendingRow) {}

  async get(state: string): Promise<OauthPendingRow | undefined> {
    return state === this.row.state ? this.row : undefined;
  }

  async consume(state: string): Promise<OauthPendingRow | undefined> {
    const row = await this.get(state);
    if (!row) return undefined;
    await this.delete(state);
    return row;
  }

  async create(input: OauthPendingRow): Promise<void> {
    this.row = input;
  }

  async delete(state: string): Promise<void> {
    if (state === this.row.state) {
      this.row = { ...this.row, state: "__deleted__" };
    }
  }

  async deleteExpired(_nowIso: string): Promise<number> {
    return 0;
  }
}

class MemoryProviderRegistry {
  constructor(private spec: OAuthProviderSpec) {}

  async get(providerId: string): Promise<OAuthProviderSpec | undefined> {
    return providerId === this.spec.provider_id ? this.spec : undefined;
  }

  async list(): Promise<OAuthProviderSpec[]> {
    return [this.spec];
  }

  async reload(): Promise<void> {}
}

describe("provider OAuth callback cleanup", () => {
  const prevClientId = process.env["TEST_CLIENT_ID"];
  const prevClientSecret = process.env["TEST_CLIENT_SECRET"];

  beforeEach(() => {
    process.env["TEST_CLIENT_ID"] = "client-1";
    process.env["TEST_CLIENT_SECRET"] = "secret-1";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const resolved = typeof url === "string" ? url : url.toString();
      if (resolved === "https://auth.test/token") {
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

  afterEach(() => {
    vi.restoreAllMocks();

    if (prevClientId === undefined) delete process.env["TEST_CLIENT_ID"];
    else process.env["TEST_CLIENT_ID"] = prevClientId;

    if (prevClientSecret === undefined) delete process.env["TEST_CLIENT_SECRET"];
    else process.env["TEST_CLIENT_SECRET"] = prevClientSecret;
  });

  it("revokes stored token handles when profile creation fails", async () => {
    const secretProvider = new MemorySecretProvider();
    const nowMs = Date.now();

    const pending: OauthPendingRow = {
      state: "state-1",
      provider_id: "test",
      agent_id: "default",
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 60_000).toISOString(),
      pkce_verifier: "verifier",
      redirect_uri: "http://localhost:8788/providers/test/oauth/callback",
      scopes: "scope1",
      mode: "auth_code" satisfies OauthPendingMode,
      metadata: {},
    };

    const pendingDal = new MemoryPendingDal(pending);
    const registry = new MemoryProviderRegistry({
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id_env: "TEST_CLIENT_ID",
      client_secret_env: "TEST_CLIENT_SECRET",
      token_endpoint_basic_auth: false,
    });

    const authProfileDal = {
      create: async () => {
        throw new Error("db down");
      },
    } as unknown as AuthProfileDal;

    const app = createProviderOAuthRoutes({
      oauthPendingDal: pendingDal as any,
      oauthProviderRegistry: registry as any,
      authProfileDal,
      secretProviderForAgent: async () => secretProvider,
    });

    const res = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(pending.state)}&code=code-1`,
      { headers: { accept: "application/json" } },
    );

    expect(res.status).toBe(502);
    expect(await secretProvider.list()).toHaveLength(0);
  });

  it("consumes pending state when callback returns an OAuth error", async () => {
    const secretProvider = new MemorySecretProvider();
    const nowMs = Date.now();

    const pending: OauthPendingRow = {
      state: "state-1",
      provider_id: "test",
      agent_id: "default",
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 60_000).toISOString(),
      pkce_verifier: "verifier",
      redirect_uri: "http://localhost:8788/providers/test/oauth/callback",
      scopes: "scope1",
      mode: "auth_code" satisfies OauthPendingMode,
      metadata: {},
    };

    const pendingDal = new MemoryPendingDal(pending);
    const registry = new MemoryProviderRegistry({
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id_env: "TEST_CLIENT_ID",
      client_secret_env: "TEST_CLIENT_SECRET",
      token_endpoint_basic_auth: false,
    });

    const app = createProviderOAuthRoutes({
      oauthPendingDal: pendingDal as any,
      oauthProviderRegistry: registry as any,
      authProfileDal: {} as any,
      secretProviderForAgent: async () => secretProvider,
    });

    const res = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(pending.state)}&error=access_denied`,
      { headers: { accept: "text/html" } },
    );

    expect(res.status).toBe(400);
    expect(await pendingDal.get(pending.state)).toBeUndefined();

    const reuse = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(pending.state)}&code=code-1`,
      { headers: { accept: "text/html" } },
    );
    expect(reuse.status).toBe(400);
  });
});
