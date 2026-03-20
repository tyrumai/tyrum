import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { SecretHandle } from "@tyrum/contracts";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createProviderOAuthRoutes } from "../../src/routes/provider-oauth.js";
import type { OAuthProviderSpec } from "../../src/modules/oauth/provider-registry.js";
import type { OauthPendingMode, OauthPendingRow } from "../../src/modules/oauth/pending-dal.js";
import type { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

class MemorySecretProvider implements SecretProvider {
  private byId = new Map<string, { handle: SecretHandle; value: string }>();

  async resolve(handle: SecretHandle): Promise<string | null> {
    return this.byId.get(handle.handle_id)?.value ?? null;
  }

  async store(secretKey: string, value: string): Promise<SecretHandle> {
    const handle: SecretHandle = {
      handle_id: secretKey,
      provider: "db",
      scope: secretKey,
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

  async get(input: { tenantId: string; state: string }): Promise<OauthPendingRow | undefined> {
    return input.tenantId === this.row.tenant_id && input.state === this.row.state
      ? this.row
      : undefined;
  }

  async getByState(state: string): Promise<OauthPendingRow | undefined> {
    return state === this.row.state ? this.row : undefined;
  }

  async consume(input: { tenantId: string; state: string }): Promise<OauthPendingRow | undefined> {
    const row = await this.get(input);
    if (!row) return undefined;
    await this.delete(input);
    return row;
  }

  async consumeByState(state: string): Promise<OauthPendingRow | undefined> {
    const row = await this.getByState(state);
    if (!row) return undefined;
    await this.delete({ tenantId: row.tenant_id, state });
    return row;
  }

  async create(input: OauthPendingRow): Promise<void> {
    this.row = input;
  }

  async delete(input: { tenantId: string; state: string }): Promise<void> {
    if (input.tenantId === this.row.tenant_id && input.state === this.row.state) {
      this.row = { ...this.row, state: "__deleted__" };
    }
  }

  async deleteExpired(_input: { tenantId: string; nowIso: string }): Promise<number> {
    return 0;
  }
}

class MemoryProviderRegistry {
  constructor(private spec: OAuthProviderSpec) {}

  async get(input: {
    tenantId: string;
    providerId: string;
  }): Promise<OAuthProviderSpec | undefined> {
    return input.tenantId === this.spec.tenant_id && input.providerId === this.spec.provider_id
      ? this.spec
      : undefined;
  }

  async list(input: { tenantId: string }): Promise<OAuthProviderSpec[]> {
    return input.tenantId === this.spec.tenant_id ? [this.spec] : [];
  }
}

function createIdentityScopeDalStub() {
  return {
    resolvePrimaryAgentKey: vi.fn(async () => "default"),
  };
}

describe("provider OAuth callback cleanup", () => {
  beforeEach(() => {
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
  });

  it("revokes stored token handles when profile creation fails", async () => {
    const secretProvider = new MemorySecretProvider();
    const nowMs = Date.now();

    const pending: OauthPendingRow = {
      tenant_id: DEFAULT_TENANT_ID,
      state: "state-1",
      provider_id: "test",
      agent_key: "default",
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
      tenant_id: DEFAULT_TENANT_ID,
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id: "client-1",
      token_endpoint_basic_auth: false,
    });

    const authProfileDal = {
      getByKey: async () => undefined,
      create: async () => {
        throw new Error("db down");
      },
    } as unknown as AuthProfileDal;

    const app = createProviderOAuthRoutes({
      oauthPendingDal: pendingDal as any,
      oauthProviderRegistry: registry as any,
      authProfileDal,
      identityScopeDal: createIdentityScopeDalStub() as any,
      secretProviderForTenant: () => secretProvider,
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
      tenant_id: DEFAULT_TENANT_ID,
      state: "state-1",
      provider_id: "test",
      agent_key: "default",
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
      tenant_id: DEFAULT_TENANT_ID,
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id: "client-1",
      token_endpoint_basic_auth: false,
    });

    const app = createProviderOAuthRoutes({
      oauthPendingDal: pendingDal as any,
      oauthProviderRegistry: registry as any,
      authProfileDal: {} as any,
      identityScopeDal: createIdentityScopeDalStub() as any,
      secretProviderForTenant: () => secretProvider,
    });

    const res = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(pending.state)}&error=access_denied`,
      { headers: { accept: "text/html" } },
    );

    expect(res.status).toBe(400);
    expect(await pendingDal.getByState(pending.state)).toBeUndefined();

    const reuse = await app.request(
      `/providers/test/oauth/callback?state=${encodeURIComponent(pending.state)}&code=code-1`,
      { headers: { accept: "text/html" } },
    );
    expect(reuse.status).toBe(400);
  });

  it("does not log OAuth state when pending consume fails", async () => {
    const registry = new MemoryProviderRegistry({
      tenant_id: DEFAULT_TENANT_ID,
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id: "client-1",
      token_endpoint_basic_auth: false,
    });

    const oauthPendingDal = {
      async consumeByState() {
        throw new Error("db down");
      },
    } as any;

    const logger = { warn: vi.fn() } as any;
    const app = createProviderOAuthRoutes({
      oauthPendingDal,
      oauthProviderRegistry: registry as any,
      authProfileDal: {} as any,
      identityScopeDal: createIdentityScopeDalStub() as any,
      secretProviderForTenant: () => new MemorySecretProvider(),
      logger,
    });

    const res = await app.request(
      `/providers/test/oauth/callback?state=state-1&error=access_denied`,
      { headers: { accept: "text/html" } },
    );

    expect(res.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [event, meta] = logger.warn.mock.calls[0]!;
    expect(event).toBe("oauth.pending_consume_failed");
    expect(meta).toEqual(expect.objectContaining({ provider: "test", error: "db down" }));
    expect(meta).not.toHaveProperty("state");
  });

  it("preserves mount prefix when deriving redirect_uri", async () => {
    const secretProvider = new MemorySecretProvider();
    const registry = new MemoryProviderRegistry({
      tenant_id: DEFAULT_TENANT_ID,
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id: "client-1",
      token_endpoint_basic_auth: false,
    });

    const oauthPendingDal = {
      async deleteExpired() {
        return 0;
      },
      async create() {},
    } as any;

    const mounted = new Hono();
    mounted.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    mounted.route(
      "/prefix",
      createProviderOAuthRoutes({
        oauthPendingDal,
        oauthProviderRegistry: registry as any,
        authProfileDal: {} as any,
        identityScopeDal: createIdentityScopeDalStub() as any,
        secretProviderForTenant: () => secretProvider,
      }),
    );

    const res = await mounted.request(
      new Request("https://example.test/prefix/providers/test/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    const authorizeUrl = new URL(json.authorize_url);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.test/prefix/providers/test/oauth/callback",
    );
  });

  it("logs when pending cleanup fails during authorization", async () => {
    const secretProvider = new MemorySecretProvider();
    const registry = new MemoryProviderRegistry({
      tenant_id: DEFAULT_TENANT_ID,
      provider_id: "test",
      display_name: "Test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
      scopes: ["scope1"],
      client_id: "client-1",
      token_endpoint_basic_auth: false,
    });

    const oauthPendingDal = {
      async deleteExpired() {
        throw new Error("db down");
      },
      async create() {},
    } as any;

    const logger = { warn: vi.fn(), info: vi.fn() } as any;

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-2",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route(
      "/",
      createProviderOAuthRoutes({
        oauthPendingDal,
        oauthProviderRegistry: registry as any,
        authProfileDal: {} as any,
        identityScopeDal: createIdentityScopeDalStub() as any,
        secretProviderForTenant: () => secretProvider,
        logger,
      }),
    );

    const res = await app.request(
      new Request("https://example.test/providers/test/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "oauth.pending_delete_expired_failed",
      expect.objectContaining({ error: "db down" }),
    );
  });
});
