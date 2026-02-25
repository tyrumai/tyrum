import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { APICallError, type LanguageModelV3 } from "@ai-sdk/provider";

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
          if (apiKey === "OLD_ACCESS") {
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

class MemorySecretProvider implements SecretProvider {
  private readonly values = new Map<string, string>();
  private readonly handles = new Map<string, SecretHandle>();

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
    return [...this.handles.values()];
  }
}

describe("AgentRuntime OAuth refresh (expires_at null)", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    usedApiKeys.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    delete process.env["OAUTH_TEST_CLIENT_ID"];
    delete process.env["OAUTH_TEST_CLIENT_SECRET"];
  });

  it("refreshes and retries on 401 when expires_at is null", async () => {
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
    const accessHandle = await secretProvider.store("oauth:openai:agent-1:access", "OLD_ACCESS");
    const refreshHandle = await secretProvider.store(
      "oauth:openai:agent-1:refresh",
      "REFRESH_TOKEN",
    );

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      profileId: "profile-1",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: accessHandle.handle_id,
        refresh_token_handle: refreshHandle.handle_id,
      },
      expiresAt: null,
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

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      sessionId: "session-1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect(res).toMatchObject({ text: "ok" });

    expect(tokenCalls).toBe(1);
    expect(usedApiKeys).toEqual(["OLD_ACCESS", "NEW_ACCESS"]);

    const updated = await authProfileDal.getById("profile-1");
    expect(updated?.status).toBe("active");
    expect(updated?.disabled_reason).toBeNull();
    expect(updated?.expires_at).toBeNull();
  });
});
