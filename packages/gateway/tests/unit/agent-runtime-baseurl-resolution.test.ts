import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import type { LanguageModelV3 } from "@ai-sdk/provider";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const seenBaseUrls: Array<string | undefined> = [];

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { providerId: string; baseURL?: string }) => {
      seenBaseUrls.push(input.baseURL);

      return {
        languageModel(modelId: string) {
          const model: LanguageModelV3 = {
            specificationVersion: "v3",
            provider: input.providerId,
            modelId,
            supportedUrls: {},
            async doGenerate() {
              return { text: "ok" } as unknown as Awaited<
                ReturnType<LanguageModelV3["doGenerate"]>
              >;
            },
            async doStream() {
              throw new Error("not implemented");
            },
          };
          return model;
        },
      };
    },
  };
});

describe("AgentRuntime baseURL resolution", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenBaseUrls.length = 0;
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("prefers endpoint env vars over catalog api for language models", async () => {
    process.env["OPENAI_API_KEY"] = "openai-key";
    process.env["OPENAI_BASE_URL"] = "https://env.example";
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
          env: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
          npm: "@ai-sdk/openai",
          api: "https://catalog.example",
          models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" } },
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

    expect(seenBaseUrls.length).toBeGreaterThan(0);
    expect(seenBaseUrls.every((x) => x === "https://env.example")).toBe(true);
  });
});
