import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const createdPipelines: any[] = [];
const seenProviderInputs: any[] = [];

vi.mock("../../src/modules/memory/embedding-pipeline.js", () => {
  return {
    EmbeddingPipeline: class {
      constructor(opts: any) {
        createdPipelines.push(opts);
      }
      async search() {
        return [];
      }
    },
  };
});

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: any) => {
      seenProviderInputs.push(input);
      return {
        embeddingModel(_modelId: string) {
          return { kind: "mock-embedding-model" };
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

describe("AgentRuntime embedding pipeline selection", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    createdPipelines.length = 0;
    seenProviderInputs.length = 0;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("allows embeddings for providers without API keys", async () => {
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
        local: {
          id: "local",
          name: "Local",
          env: [],
          npm: "@ai-sdk/local",
          models: {
            chat: { id: "chat", name: "Chat" },
            "embedding-1": { id: "embedding-1", name: "Embedding 1", family: "embedding" },
          },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      fetchImpl,
    });

    const pipeline = await (runtime as any).resolveEmbeddingPipeline("local/chat", "session-1");
    expect(pipeline).toBeDefined();

    expect(seenProviderInputs[0]).toMatchObject({
      providerId: "local",
    });
    expect(Object.hasOwn(seenProviderInputs[0], "apiKey")).toBe(true);
    expect(seenProviderInputs[0].apiKey).toBeUndefined();
    expect(createdPipelines[0]).toMatchObject({
      embeddingModelId: "local/embedding-1",
    });
  });

  it("uses auth profiles and can fall back to OpenAI embeddings for non-OpenAI primary models", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
        openai: {
          id: "openai",
          name: "OpenAI",
          env: ["OPENAI_API_KEY"],
          npm: "@ai-sdk/openai",
          api: "https://api.openai.com/v1",
          models: {
            "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
            "text-embedding-3-small": { id: "text-embedding-3-small", name: "Embeddings", family: "embedding" },
          },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const secretProvider = new MemorySecretProvider();
    const apiKeyHandle = await secretProvider.store("api-key:openai", "OPENAI_KEY");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      profileId: "profile-1",
      agentId: "agent-1",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: apiKeyHandle.handle_id },
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

    const pipeline = await (runtime as any).resolveEmbeddingPipeline(
      "anthropic/claude-3.5-sonnet",
      "session-1",
    );
    expect(pipeline).toBeDefined();

    expect(seenProviderInputs[0]).toMatchObject({
      providerId: "openai",
      apiKey: "OPENAI_KEY",
    });
    expect(createdPipelines[0]).toMatchObject({
      embeddingModelId: "openai/text-embedding-3-small",
      agentId: "agent-1",
    });
  });
});
