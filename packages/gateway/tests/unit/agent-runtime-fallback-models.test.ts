import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "@ai-sdk/provider";
import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import type { GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ExecutionProfileModelAssignmentDal } from "../../src/modules/models/execution-profile-model-assignment-dal.js";
import { SessionModelOverrideDal } from "../../src/modules/models/session-model-override-dal.js";
import {
  createAgentRuntime,
  createConfiguredPreset,
  createTestContainer,
  createUiSession,
  notFoundFetch,
  resolveSessionModel,
  seedModelsDevCache,
} from "./agent-runtime-fallback-models.test-support.js";

const seenProviders: string[] = [];
let openaiGenerateError: unknown = new Error("openai down");

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { providerId: string }) => {
      const providerId = input.providerId;
      if (providerId === "gitlab") {
        const model: LanguageModelV2 = {
          specificationVersion: "v2",
          provider: providerId,
          modelId: `${providerId}/mock`,
          supportedUrls: {},
          async doGenerate() {
            seenProviders.push(providerId);
            return {} as Awaited<ReturnType<LanguageModelV2["doGenerate"]>>;
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
      }

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

  it("tries configured fallback models after a primary model invocation fails", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      fallback: ["anthropic/claude-3.5-sonnet"],
      sessionId: "session-1",
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["openai", "anthropic"]);
  });

  it("rejects fallback chains that mix model specification versions", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "gitlab"]);

    const runtime = await createAgentRuntime(container, { fetchImpl: notFoundFetch });

    await expect(
      resolveSessionModel(runtime, {
        model: "openai/gpt-4.1",
        fallback: ["gitlab/duo-chat"],
        sessionId: "session-mixed-specs",
        fetchImpl: notFoundFetch,
      }),
    ).rejects.toThrow("configured model candidates must share one specification version");
    expect(seenProviders).toEqual([]);
  });

  it("rejects legacy short fallback model ids", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });

    await expect(
      resolveSessionModel(runtime, {
        model: "openai/gpt-4.1",
        fallback: ["gpt-4.1-mini", "anthropic/claude-3.5-sonnet"],
        sessionId: "session-1",
        fetchImpl: notFoundFetch,
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

    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      fallback: ["anthropic/claude-3.5-sonnet"],
      sessionId: "session-1",
      fetchImpl: notFoundFetch,
    });

    await expect(model.doGenerate({} as any)).rejects.toThrow("bad request");
    expect(seenProviders).toEqual(["openai"]);
  });

  it("respects per-session /model overrides", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const session = await createUiSession(container, "thread-1");

    await new SessionModelOverrideDal(container.db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      modelId: "anthropic/claude-3.5-sonnet",
    });

    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      sessionId: session.session_id,
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("fails closed when neither the agent nor the execution profile has a model configured", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });

    await expect(
      resolveSessionModel(runtime, {
        model: null,
        sessionId: "session-unconfigured",
        executionProfileId: "interaction",
        profileModelId: null,
        fetchImpl: notFoundFetch,
      }),
    ).rejects.toThrow("no model configured for execution profile 'interaction'");
    expect(seenProviders).toEqual([]);
  });

  it("uses execution-profile preset assignments before legacy profile defaults", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    await createConfiguredPreset(container, {
      presetKey: "anthropic-interaction",
      displayName: "Anthropic Interaction",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "high" },
    });
    await new ExecutionProfileModelAssignmentDal(container.db).setMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "anthropic-interaction" }],
    });

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      sessionId: "session-profile-assigned",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("tries configured fallback models after an execution-profile preset invocation fails", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    await createConfiguredPreset(container, {
      presetKey: "openai-interaction",
      displayName: "OpenAI Interaction",
      providerKey: "openai",
      modelId: "gpt-4.1",
      options: {},
    });
    await new ExecutionProfileModelAssignmentDal(container.db).setMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "openai-interaction" }],
    });

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      fallback: ["anthropic/claude-3.5-sonnet"],
      sessionId: "session-assigned-fallback",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["openai", "anthropic"]);
  });

  it("uses session preset overrides before execution-profile assignments", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    await createConfiguredPreset(container, {
      presetKey: "anthropic-session",
      displayName: "Anthropic Session",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "medium" },
    });
    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const session = await createUiSession(container, "thread-preset");

    await new SessionModelOverrideDal(container.db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: session.session_id,
      modelId: "anthropic/claude-3.5-sonnet",
      presetKey: "anthropic-session",
    });

    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      sessionId: session.session_id,
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("uses configured execution-profile model assignments before legacy defaults", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    await createConfiguredPreset(container, {
      presetKey: "anthropic-default",
      displayName: "Anthropic Default",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "high" },
    });
    await new ExecutionProfileModelAssignmentDal(container.db).setMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "anthropic-default" }],
    });

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });
    const model = await resolveSessionModel(runtime, {
      model: "openai/gpt-4.1",
      sessionId: "session-assigned",
      executionProfileId: "interaction",
      profileModelId: "openai/gpt-4.1",
      fetchImpl: notFoundFetch,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["anthropic"]);
  });

  it("fails closed when no execution-profile or agent model is configured", async () => {
    container = createTestContainer();
    await seedModelsDevCache(container, ["openai", "anthropic"]);

    const runtime = await createAgentRuntime(container, {
      fetchImpl: notFoundFetch,
      withSecretProvider: true,
    });

    await expect(
      resolveSessionModel(runtime, {
        model: null,
        sessionId: "session-unconfigured",
        executionProfileId: "interaction",
        profileModelId: null,
        fetchImpl: notFoundFetch,
      }),
    ).rejects.toThrow("no model configured for execution profile 'interaction'");
    expect(seenProviders).toEqual([]);
  });
});
