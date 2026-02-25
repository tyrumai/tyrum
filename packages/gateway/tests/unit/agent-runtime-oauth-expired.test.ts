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

describe("AgentRuntime OAuth expired token handling", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenApiKeys.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("does not fall back to an expired OAuth access token when refresh cannot run", async () => {
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

    const secretProvider = new MemorySecretProvider();

    const oauthAccessHandle = await secretProvider.store(
      "oauth:openai:agent-1:access",
      "OAUTH_EXPIRED",
    );
    const refreshHandle = await secretProvider.store("oauth:openai:agent-1:refresh", "REFRESH");
    const apiKeyHandle = await secretProvider.store("api:openai:agent-1:key", "API_KEY");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      profileId: "a-oauth",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: oauthAccessHandle.handle_id,
        refresh_token_handle: refreshHandle.handle_id,
      },
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      createdBy: { kind: "test" },
    });
    await authProfileDal.create({
      profileId: "b-api",
      agentId: "agent-1",
      provider: "openai",
      type: "api_key",
      secretHandles: {
        api_key_handle: apiKeyHandle.handle_id,
      },
      expiresAt: null,
      createdBy: { kind: "test" },
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
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      sessionId: "session-1",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenApiKeys).toEqual(["API_KEY"]);

    const oauth = await authProfileDal.getById("a-oauth");
    expect(oauth?.status).toBe("active");
  });
});
