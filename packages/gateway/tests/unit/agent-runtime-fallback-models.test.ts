import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { APICallError } from "@ai-sdk/provider";
import type { LanguageModelV3 } from "@ai-sdk/provider";

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
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("tries configured fallback models after a primary model invocation fails", async () => {
    process.env["OPENAI_API_KEY"] = "openai-key";
    process.env["ANTHROPIC_API_KEY"] = "anthropic-key";
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "0";

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
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      fetchImpl,
    });

    const model = await (runtime as unknown as {
      resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
    }).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          fallback: ["anthropic/claude-3.5-sonnet"],
          options: {},
        },
      },
      sessionId: "session-1",
      fetchImpl,
    });

    const res = await model.doGenerate({} as any);
    expect((res as any).text).toBe("ok");
    expect(seenProviders).toEqual(["openai", "anthropic"]);
  });

  it("rejects legacy short fallback model ids", async () => {
    process.env["OPENAI_API_KEY"] = "openai-key";
    process.env["ANTHROPIC_API_KEY"] = "anthropic-key";
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "0";

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
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      fetchImpl,
    });

    await expect(
      (runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }).resolveSessionModel({
        config: {
          model: {
            model: "openai/gpt-4.1",
            fallback: ["gpt-4.1-mini", "anthropic/claude-3.5-sonnet"],
            options: {},
          },
        },
        sessionId: "session-1",
        fetchImpl,
      }),
    ).rejects.toThrow("expected provider/model");
    expect(seenProviders).toEqual([]);
  });

  it("does not try fallback models for non-transient API errors", async () => {
    process.env["OPENAI_API_KEY"] = "openai-key";
    process.env["ANTHROPIC_API_KEY"] = "anthropic-key";
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "0";

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
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      fetchImpl,
    });

    const model = await (runtime as unknown as {
      resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
    }).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          fallback: ["anthropic/claude-3.5-sonnet"],
          options: {},
        },
      },
      sessionId: "session-1",
      fetchImpl,
    });

    await expect(model.doGenerate({} as any)).rejects.toThrow("bad request");
    expect(seenProviders).toEqual(["openai"]);
  });
});
