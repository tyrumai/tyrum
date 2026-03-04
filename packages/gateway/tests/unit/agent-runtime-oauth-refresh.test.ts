import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APICallError, type LanguageModelV3 } from "@ai-sdk/provider";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { DbSecretProvider } from "../../src/modules/secret/provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const seenApiKeys: Array<string | undefined> = [];

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { apiKey?: string }) => {
      const apiKey = input.apiKey;

      const model: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: "mock",
        modelId: "mock-model",
        supportedUrls: {},
        async doGenerate() {
          seenApiKeys.push(apiKey);
          if (apiKey === "OLD_ACCESS") {
            throw new APICallError({
              message: "unauthorized",
              url: "https://api.example/v1",
              requestBodyValues: {},
              statusCode: 401,
              responseBody: '{"error":"unauthorized"}',
            });
          }
          if (!apiKey) {
            throw new Error("missing apiKey");
          }
          return { text: "ok" } as unknown as Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;
        },
        async doStream() {
          throw new Error("not implemented");
        },
      };

      return {
        languageModel() {
          return model;
        },
      };
    },
  };
});

describe("AgentRuntime OAuth refresh", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenApiKeys.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    delete process.env["OAUTH_TEST_CLIENT_ID"];
    delete process.env["OAUTH_TEST_CLIENT_SECRET"];
  });

  async function seedCatalog(): Promise<void> {
    const cacheDal = new ModelsDevCacheDal(container!.db);
    const nowIso = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: null,
      sha256: "sha",
      json: JSON.stringify({
        openai: {
          id: "openai",
          name: "OpenAI",
          env: [],
          npm: "@ai-sdk/openai",
          models: {
            "gpt-4.1": {
              id: "gpt-4.1",
              name: "GPT-4.1",
            },
          },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });
  }

  it("refreshes an OAuth profile on 401 and reuses the refreshed access token", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OAUTH_TEST_CLIENT_ID"] = "client-id";
    process.env["OAUTH_TEST_CLIENT_SECRET"] = "client-secret";

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedCatalog();

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });

    const accessKey = "oauth:openai:access";
    const refreshKey = "oauth:openai:refresh";
    const accessHandle = await secretProvider.store(accessKey, "OLD_ACCESS");
    const refreshHandle = await secretProvider.store(refreshKey, "REFRESH_TOKEN");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: accessKey,
        refresh_token: refreshKey,
      },
    });

    (container as any).oauthProviderRegistry = {
      async get(providerId: string) {
        if (providerId !== "openai") return undefined;
        return {
          provider_id: "openai",
          token_endpoint: "https://oauth.example/token",
          scopes: [],
          client_id_env: "OAUTH_TEST_CLIENT_ID",
          client_secret_env: "OAUTH_TEST_CLIENT_SECRET",
          token_endpoint_basic_auth: true,
        };
      },
      async list() {
        return [];
      },
      async reload() {
        // no-op
      },
    };

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth.example/token") {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            access_token: "NEW_ACCESS",
            refresh_token: "NEW_REFRESH",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const model = await (runtime as any).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: randomUUID(),
      fetchImpl,
    });

    await model.doGenerate({} as any);
    await model.doGenerate({} as any);

    expect(seenApiKeys).toEqual(["OLD_ACCESS", "NEW_ACCESS", "NEW_ACCESS"]);
    expect(await secretProvider.resolve(accessHandle)).toBe("NEW_ACCESS");
    expect(await secretProvider.resolve(refreshHandle)).toBe("NEW_REFRESH");
  });

  it("keeps the existing refresh token when the refresh response omits refresh_token", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OAUTH_TEST_CLIENT_ID"] = "client-id";
    process.env["OAUTH_TEST_CLIENT_SECRET"] = "client-secret";

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedCatalog();

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });

    const accessKey = "oauth:openai:access";
    const refreshKey = "oauth:openai:refresh";
    await secretProvider.store(accessKey, "OLD_ACCESS");
    const refreshHandle = await secretProvider.store(refreshKey, "REFRESH_TOKEN");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: accessKey,
        refresh_token: refreshKey,
      },
    });

    (container as any).oauthProviderRegistry = {
      async get(providerId: string) {
        if (providerId !== "openai") return undefined;
        return {
          provider_id: "openai",
          token_endpoint: "https://oauth.example/token",
          scopes: [],
          client_id_env: "OAUTH_TEST_CLIENT_ID",
          client_secret_env: "OAUTH_TEST_CLIENT_SECRET",
          token_endpoint_basic_auth: true,
        };
      },
      async list() {
        return [];
      },
      async reload() {
        // no-op
      },
    };

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://oauth.example/token") {
        return new Response(
          JSON.stringify({
            access_token: "NEW_ACCESS",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const model = await (runtime as any).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: randomUUID(),
      fetchImpl,
    });

    await model.doGenerate({} as any);
    expect(await secretProvider.resolve(refreshHandle)).toBe("REFRESH_TOKEN");
  });

  it("disables an OAuth profile when refresh fails and rotates to the next profile", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedCatalog();

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });

    const accessKey = "oauth:openai:access";
    const refreshKey = "oauth:openai:refresh";
    await secretProvider.store(accessKey, "OLD_ACCESS");
    await secretProvider.store(refreshKey, "REFRESH_TOKEN");
    await secretProvider.store("api-key:openai:good", "GOOD_KEY");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "a-oauth",
      providerKey: "openai",
      type: "oauth",
      secretKeys: { access_token: accessKey, refresh_token: refreshKey },
    });
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "b-api",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai:good" },
    });

    (container as any).oauthProviderRegistry = {
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async reload() {
        // no-op
      },
    };

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const model = await (runtime as any).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: randomUUID(),
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenApiKeys).toEqual(["OLD_ACCESS", "GOOD_KEY"]);

    const oauthProfile = await authProfileDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "a-oauth",
    });
    expect(oauthProfile?.status).toBe("disabled");
  });
});
