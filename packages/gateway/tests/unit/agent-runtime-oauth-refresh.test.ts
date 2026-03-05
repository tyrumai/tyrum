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
    await secretProvider.store("oauth:openai:client_secret", "client-secret");

    await container.db.run(
      `INSERT INTO oauth_provider_configs (
         tenant_id,
         provider_id,
         token_endpoint,
         scopes_json,
         client_id,
         client_secret_key,
         token_endpoint_basic_auth
       ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        DEFAULT_TENANT_ID,
        "openai",
        "https://oauth.example/token",
        "[]",
        "client-id",
        "oauth:openai:client_secret",
      ],
    );

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
    await secretProvider.store("oauth:openai:client_secret", "client-secret");

    await container.db.run(
      `INSERT INTO oauth_provider_configs (
         tenant_id,
         provider_id,
         token_endpoint,
         scopes_json,
         client_id,
         client_secret_key,
         token_endpoint_basic_auth
       ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        DEFAULT_TENANT_ID,
        "openai",
        "https://oauth.example/token",
        "[]",
        "client-id",
        "oauth:openai:client_secret",
      ],
    );

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
