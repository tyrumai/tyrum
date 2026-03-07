import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { resolveSessionModel } from "../../src/modules/agent/runtime/session-model-resolution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: { providerId: string }) => {
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

describe("AgentRuntime language model wrapper metadata", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    delete process.env["OPENAI_API_KEY"];
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
  });

  it("preserves the provider SDK modelId on the rotating wrapper", async () => {
    process.env["OPENAI_API_KEY"] = "openai-key";
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
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const model = await resolveSessionModel(
      { container, secretProvider: undefined, oauthLeaseOwner: "test", fetchImpl },
      {
        config: {
          model: {
            model: "openai/gpt-4.1",
            options: {},
          },
        },
        tenantId: "default",
        sessionId: "session-1",
        fetchImpl,
      },
    );

    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4.1");
  });
});
