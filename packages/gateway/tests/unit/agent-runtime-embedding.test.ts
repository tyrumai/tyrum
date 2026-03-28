import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DbSecretProvider } from "../../src/modules/secret/provider.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";

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

describe("AgentRuntime embedding pipeline selection", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    createdPipelines.length = 0;
    seenProviderInputs.length = 0;
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

    const { resolveEmbeddingPipeline } =
      await import("../../src/modules/agent/runtime/embedding-pipeline-resolution.js");

    const ids = await new IdentityScopeDal(container.db).resolveScopeIds({
      tenantKey: "default",
      agentKey: "agent-1",
      workspaceKey: "default",
    });
    const pipeline = await resolveEmbeddingPipeline({
      container,
      fetchImpl,
      primaryModelId: "local/chat",
      conversationId: randomUUID(),
      tenantId: ids.tenantId,
      agentId: ids.agentId,
      instanceOwner: "test-owner",
    });
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
            "text-embedding-3-small": {
              id: "text-embedding-3-small",
              name: "Embeddings",
              family: "embedding",
            },
          },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const ids = await new IdentityScopeDal(container.db).resolveScopeIds({
      tenantKey: "default",
      agentKey: "agent-1",
      workspaceKey: "default",
    });
    const secretProvider = new DbSecretProvider(container.db, {
      tenantId: ids.tenantId,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });
    await secretProvider.store("api-key:openai", "OPENAI_KEY");

    const authProfileDal = new AuthProfileDal(container.db);
    await authProfileDal.create({
      tenantId: ids.tenantId,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai" },
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { resolveEmbeddingPipeline } =
      await import("../../src/modules/agent/runtime/embedding-pipeline-resolution.js");

    const pipeline = await resolveEmbeddingPipeline({
      container,
      secretProvider,
      fetchImpl,
      primaryModelId: "anthropic/claude-3.5-sonnet",
      conversationId: randomUUID(),
      tenantId: ids.tenantId,
      agentId: ids.agentId,
      instanceOwner: "test-owner",
    });
    expect(pipeline).toBeDefined();

    expect(seenProviderInputs[0]).toMatchObject({
      providerId: "openai",
      apiKey: "OPENAI_KEY",
    });
    expect(createdPipelines[0]).toMatchObject({
      embeddingModelId: "openai/text-embedding-3-small",
      scope: { tenantId: ids.tenantId, agentId: ids.agentId },
    });
  });
});
