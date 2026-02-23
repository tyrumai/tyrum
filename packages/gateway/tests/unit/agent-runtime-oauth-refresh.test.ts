import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import type { LanguageModelV3 } from "@ai-sdk/provider";

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

class MemorySecretProvider implements SecretProvider {
  private readonly values = new Map<string, string>();
  private readonly handles = new Map<string, SecretHandle>();
  public listCalls = 0;

  async resolve(handle: SecretHandle): Promise<string | null> {
    return this.values.get(handle.handle_id) ?? null;
  }

  async store(scope: string, value: string): Promise<SecretHandle> {
    const handle: SecretHandle = {
      handle_id: randomUUID(),
      provider: "memory",
      scope,
      created_at: new Date().toISOString(),
    };
    this.handles.set(handle.handle_id, handle);
    this.values.set(handle.handle_id, value);
    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    const existed = this.handles.delete(handleId);
    this.values.delete(handleId);
    return existed;
  }

  async list(): Promise<SecretHandle[]> {
    this.listCalls += 1;
    return [...this.handles.values()];
  }
}

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

  it("uses refreshed OAuth access token on subsequent model calls in the same turn", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OAUTH_TEST_CLIENT_ID"] = "client-id";
    process.env["OAUTH_TEST_CLIENT_SECRET"] = "client-secret";

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    // Seed a minimal models.dev catalog so resolveSessionModel can find the model.
    const catalog = {
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
    };
    const cacheDal = new ModelsDevCacheDal(container.db);
    const nowIso = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: null,
      sha256: "sha",
      json: JSON.stringify(catalog),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const secretProvider = new MemorySecretProvider();
    const oldAccessHandle = await secretProvider.store("oauth:openai:agent-1:access-old", "OLD_ACCESS");
    const refreshHandle = await secretProvider.store("oauth:openai:agent-1:refresh", "REFRESH_TOKEN");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      profileId: "profile-1",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: oldAccessHandle.handle_id,
        refresh_token_handle: refreshHandle.handle_id,
      },
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      createdBy: { kind: "test" },
    });

    // Stub OAuth provider registry so refresh can run.
    (container as unknown as { oauthProviderRegistry: unknown }).oauthProviderRegistry = {
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

    const model = await (runtime as unknown as {
      resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
    }).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      sessionId: "session-1",
      fetchImpl,
    });

    await model.doGenerate({} as any);
    await model.doGenerate({} as any);

    expect(seenApiKeys).toEqual(["NEW_ACCESS", "NEW_ACCESS"]);
    expect(secretProvider.listCalls).toBe(2);
  });

  it("clears expires_at when refresh response omits expires_in", async () => {
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OAUTH_TEST_CLIENT_ID"] = "client-id";
    process.env["OAUTH_TEST_CLIENT_SECRET"] = "client-secret";

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

    const secretProvider = new MemorySecretProvider();
    const oldAccessHandle = await secretProvider.store("oauth:openai:agent-1:access-old", "OLD_ACCESS");
    const refreshHandle = await secretProvider.store("oauth:openai:agent-1:refresh", "REFRESH_TOKEN");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      profileId: "profile-1",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: oldAccessHandle.handle_id,
        refresh_token_handle: refreshHandle.handle_id,
      },
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      createdBy: { kind: "test" },
    });

    (container as unknown as { oauthProviderRegistry: unknown }).oauthProviderRegistry = {
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

    let tokenCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth.example/token") {
        tokenCalls += 1;
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            access_token: "NEW_ACCESS",
            refresh_token: "NEW_REFRESH",
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

    const model = await (runtime as unknown as {
      resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
    }).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      sessionId: "session-1",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    const updated = await authProfileDal.getById("profile-1");
    expect(updated?.expires_at).toBeNull();

    await model.doGenerate({} as any);

    expect(tokenCalls).toBe(1);
    expect(seenApiKeys).toEqual(["NEW_ACCESS", "NEW_ACCESS"]);
  });
});
