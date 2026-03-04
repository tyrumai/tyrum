import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { APICallError, type LanguageModelV3 } from "@ai-sdk/provider";
import { DbSecretProvider } from "../../src/modules/secret/provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const usedApiKeys: Array<string | undefined> = [];

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { providerId: string; apiKey?: string }) => {
      const apiKey = input.apiKey;

      const model: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: input.providerId,
        modelId: `${input.providerId}/mock`,
        supportedUrls: {},
        async doGenerate() {
          usedApiKeys.push(apiKey);
          if (apiKey === "KEY1") {
            throw new APICallError({
              message: "unauthorized",
              url: "https://api.example/v1",
              requestBodyValues: {},
              statusCode: 401,
              responseBody: '{"error":"unauthorized"}',
            });
          }
          if (apiKey === "PAYMENT1" || apiKey === "PAYMENT2") {
            throw new APICallError({
              message: "payment required",
              url: "https://api.example/v1",
              requestBodyValues: {},
              statusCode: 402,
              responseBody: '{"error":"payment_required"}',
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

describe("AgentRuntime auth profile rotation", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    usedApiKeys.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    delete process.env["OPENAI_API_KEY"];
  });

  it("reloads eligible auth profiles across multiple model invocations", async () => {
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
          env: ["OPENAI_API_KEY"],
          npm: "@ai-sdk/openai",
          models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });
    await secretProvider.store("api-key:openai:1", "KEY1");
    await secretProvider.store("api-key:openai:2", "KEY2");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai:1" },
    });
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-2",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai:2" },
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: randomUUID(),
      fetchImpl,
    });

    await model.doGenerate({} as any);
    await model.doGenerate({} as any);

    // First invocation disables profile-1 and succeeds with profile-2. Subsequent invocations
    // should not retry profile-1 since it's no longer eligible.
    expect(usedApiKeys).toEqual(["KEY1", "KEY2", "KEY2"]);
  });

  it("tries env API key fallback when profiles fail with 402", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OPENAI_API_KEY"] = "ENV_KEY";

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
          env: ["OPENAI_API_KEY"],
          npm: "@ai-sdk/openai",
          models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });
    await secretProvider.store("api-key:openai:1", "PAYMENT1");
    await secretProvider.store("api-key:openai:2", "PAYMENT2");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai:1" },
    });
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-2",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai:2" },
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: randomUUID(),
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(usedApiKeys).toEqual(["PAYMENT1", "PAYMENT2", "ENV_KEY"]);
  });
});
