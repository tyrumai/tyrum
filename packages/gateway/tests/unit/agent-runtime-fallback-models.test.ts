import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { APICallError } from "@ai-sdk/provider";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "../../src/modules/models/execution-profile-model-assignment-dal.js";
import { SessionModelOverrideDal } from "../../src/modules/models/session-model-override-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DbSecretProvider } from "../../src/modules/secret/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const seenProviders: string[] = [];
let openaiGenerateError: unknown = new Error("openai down");

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { providerId: string }) => {
      const providerId = input.providerId;
      const model: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: providerId,
        modelId: `${providerId}/mock`,
        supportedUrls: {},
        async doGenerate() {
          seenProviders.push(providerId);
          if (providerId === "openai") {
            throw openaiGenerateError;
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

describe("AgentRuntime model fallbacks", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenProviders.length = 0;
    openaiGenerateError = new Error("openai down");
  });

  async function seedAuthProfiles(): Promise<DbSecretProvider> {
    const secretProvider = new DbSecretProvider(container!.db, {
      tenantId: DEFAULT_TENANT_ID,
      masterKey: Buffer.alloc(32, 7),
      keyId: "test-key",
    });
    await secretProvider.store("api-key:openai", "openai-key");
    await secretProvider.store("api-key:anthropic", "anthropic-key");

    const authProfileDal = new AuthProfileDal(container!.db);
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "openai-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "api-key:openai" },
    });
    await authProfileDal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "anthropic-1",
      providerKey: "anthropic",
      type: "api_key",
      secretKeys: { api_key: "api-key:anthropic" },
    });

    return secretProvider;
  }

  async function createConfiguredPreset(input: {
    presetKey: string;
    displayName: string;
    providerKey: string;
    modelId: string;
    options?: Record<string, unknown>;
  }) {
    return await new ConfiguredModelPresetDal(container!.db).create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: input.presetKey,
      displayName: input.displayName,
      providerKey: input.providerKey,
      modelId: input.modelId,
      options: input.options ?? {},
    });
  }

  it("tries configured fallback models after a primary model invocation fails", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
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
          fallback: ["anthropic/claude-3.5-sonnet"],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["openai", "anthropic"]);
  });

  it("rejects legacy short fallback model ids", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    await expect(
      (
        runtime as unknown as {
          resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
        }
      ).resolveSessionModel({
        config: {
          model: {
            model: "openai/gpt-4.1",
            fallback: ["gpt-4.1-mini", "anthropic/claude-3.5-sonnet"],
            options: {},
          },
        },
        tenantId: DEFAULT_TENANT_ID,
        sessionId: "session-1",
        fetchImpl,
      }),
    ).rejects.toThrow("expected provider/model");
    expect(seenProviders).toEqual([]);
  });

  it("does not try fallback models for non-transient API errors", async () => {
    openaiGenerateError = new APICallError({
      message: "bad request",
      url: "https://api.example/v1",
      requestBodyValues: { test: true },
      statusCode: 400,
      responseBody: '{"error":"invalid_request"}',
    });

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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
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
          fallback: ["anthropic/claude-3.5-sonnet"],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-1",
      fetchImpl,
    });

    await expect(model.doGenerate({} as any)).rejects.toThrow("bad request");
    expect(seenProviders).toEqual(["openai"]);
  });

  it("respects per-session /model overrides", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const session = await container.sessionDal.getOrCreate({
      scopeKeys: { tenantKey: "default", agentKey: "agent-1", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "dm",
    });

    const overrides = new SessionModelOverrideDal(container.db);
    await overrides.upsert({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      modelId: "anthropic/claude-3.5-sonnet",
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          fallback: [],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("uses execution-profile preset assignments before legacy profile defaults", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
    await createConfiguredPreset({
      presetKey: "anthropic-interaction",
      displayName: "Anthropic Interaction",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "high" },
    });
    await new ExecutionProfileModelAssignmentDal(container.db).upsertMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "anthropic-interaction" }],
    });

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
          fallback: [],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-profile-assigned",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("tries configured fallback models after an execution-profile preset invocation fails", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
    await createConfiguredPreset({
      presetKey: "openai-interaction",
      displayName: "OpenAI Interaction",
      providerKey: "openai",
      modelId: "gpt-4.1",
      options: {},
    });
    await new ExecutionProfileModelAssignmentDal(container.db).upsertMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "openai-interaction" }],
    });

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
          fallback: ["anthropic/claude-3.5-sonnet"],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-assigned-fallback",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["openai", "anthropic"]);
  });

  it("uses session preset overrides before execution-profile assignments", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
    await createConfiguredPreset({
      presetKey: "anthropic-session",
      displayName: "Anthropic Session",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "medium" },
    });
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      secretProvider,
      fetchImpl,
    });

    const session = await container.sessionDal.getOrCreate({
      scopeKeys: { tenantKey: "default", agentKey: "agent-1", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-preset",
      containerKind: "dm",
    });

    await new SessionModelOverrideDal(container.db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      modelId: "anthropic/claude-3.5-sonnet",
      presetKey: "anthropic-session",
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          fallback: [],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("uses configured execution-profile model assignments before legacy defaults", async () => {
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
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const presetDal = new ConfiguredModelPresetDal(container.db);
    await presetDal.create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: "anthropic-default",
      displayName: "Anthropic Default",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "high" },
    });
    await new ExecutionProfileModelAssignmentDal(container.db).upsertMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "anthropic-default" }],
    });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const secretProvider = await seedAuthProfiles();
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
          fallback: [],
          options: {},
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-assigned",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });
});
