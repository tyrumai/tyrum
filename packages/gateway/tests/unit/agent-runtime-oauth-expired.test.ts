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
import { resolveSessionModel } from "../../src/modules/agent/runtime/session-model-resolution.js";

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
          if (apiKey === "OAUTH_EXPIRED") {
            throw new APICallError({
              message: "unauthorized",
              url: "https://api.example/v1",
              requestBodyValues: {},
              statusCode: 401,
              responseBody: '{"error":"unauthorized"}',
            });
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

describe("AgentRuntime OAuth rotation when refresh cannot run", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenApiKeys.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("rotates to another profile without retrying the same token when the refresh lease is held", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const cacheDal = new ModelsDevCacheDal(container.db);
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
          models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    // Prevent refresh from running (simulate another instance holding the lease).
    (container as unknown as { oauthRefreshLeaseDal: unknown }).oauthRefreshLeaseDal = {
      async tryAcquire() {
        return false;
      },
      async release() {
        // no-op
      },
    };

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });

    const accessKey = "oauth:openai:access";
    const refreshKey = "oauth:openai:refresh";
    const apiKeyKey = "api:openai:key";
    const accessHandle = await secretProvider.store(accessKey, "OAUTH_EXPIRED");
    await secretProvider.store(refreshKey, "REFRESH_TOKEN");
    await secretProvider.store(apiKeyKey, "API_KEY");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "a-oauth",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: accessKey,
        refresh_token: refreshKey,
      },
    });
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "b-api",
      providerKey: "openai",
      type: "api_key",
      secretKeys: {
        api_key: apiKeyKey,
      },
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const model = await resolveSessionModel(
      { container, secretProvider, oauthLeaseOwner: "test", fetchImpl },
      {
        config: { model: { model: "openai/gpt-4.1", options: {} } },
        tenantId: DEFAULT_TENANT_ID,
        sessionId: randomUUID(),
        fetchImpl,
      },
    );

    await model.doGenerate({} as any);

    expect(seenApiKeys).toEqual(["OAUTH_EXPIRED", "API_KEY"]);
    expect(await secretProvider.resolve(accessHandle)).toBe("OAUTH_EXPIRED");

    const oauth = await authProfileDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "a-oauth",
    });
    expect(oauth?.status).toBe("active");
  });
});
