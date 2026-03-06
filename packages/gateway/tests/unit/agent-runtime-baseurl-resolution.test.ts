import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "../../src/modules/models/execution-profile-model-assignment-dal.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { LanguageModelV3 } from "@ai-sdk/provider";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const seenProviderInputs: Array<{
  baseURL?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
}> = [];

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: {
      providerId: string;
      baseURL?: string;
      headers?: Record<string, string>;
      options?: Record<string, unknown>;
    }) => {
      seenProviderInputs.push({
        baseURL: input.baseURL,
        headers: input.headers,
        options: input.options,
      });

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
  let tempDir: string | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    seenProviderInputs.length = 0;
    if (tempDir) {
      const { rmSync } = await import("node:fs");
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("uses catalog api as baseURL when no model override is provided", async () => {
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    tempDir = await (
      await import("node:fs/promises")
    ).mkdtemp(join((await import("node:os")).tmpdir(), "tyrum-baseurl-resolution-"));
    const secretProvider = await createDbSecretProvider({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: tempDir,
      tenantId: DEFAULT_TENANT_ID,
    });
    await secretProvider.store("openai_api_key", "openai-key");
    await new AuthProfileDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "openai_api_key" },
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
      tenantId: DEFAULT_TENANT_ID,
      fetchImpl,
      secretProvider,
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: { model: { model: "openai/gpt-4.1", options: {} } },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-1",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenProviderInputs.length).toBeGreaterThan(0);
    expect(seenProviderInputs.every((input) => input.baseURL === "https://catalog.example")).toBe(
      true,
    );
  });

  it("preserves agent baseURL overrides when execution-profile presets are assigned", async () => {
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    tempDir = await (
      await import("node:fs/promises")
    ).mkdtemp(join((await import("node:os")).tmpdir(), "tyrum-baseurl-resolution-"));
    const secretProvider = await createDbSecretProvider({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: tempDir,
      tenantId: DEFAULT_TENANT_ID,
    });
    await secretProvider.store("openai_api_key", "openai-key");
    await new AuthProfileDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "openai_api_key" },
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

    await new ConfiguredModelPresetDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: "interaction-default",
      displayName: "Interaction Default",
      providerKey: "openai",
      modelId: "gpt-4.1",
      options: {},
    });
    await new ExecutionProfileModelAssignmentDal(container.db).upsertMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "interaction-default" }],
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      tenantId: DEFAULT_TENANT_ID,
      fetchImpl,
      secretProvider,
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          options: { baseURL: "https://override.example/v1" },
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-assigned",
      executionProfileId: "interaction",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenProviderInputs.length).toBeGreaterThan(0);
    expect(
      seenProviderInputs.every((input) => input.baseURL === "https://override.example/v1"),
    ).toBe(true);
  });

  it("keeps agent model options authoritative over execution-profile preset defaults", async () => {
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    tempDir = await (
      await import("node:fs/promises")
    ).mkdtemp(join((await import("node:os")).tmpdir(), "tyrum-baseurl-resolution-"));
    const secretProvider = await createDbSecretProvider({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: tempDir,
      tenantId: DEFAULT_TENANT_ID,
    });
    await secretProvider.store("openai_api_key", "openai-key");
    await new AuthProfileDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "api_key",
      secretKeys: { api_key: "openai_api_key" },
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
          models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", reasoning: true } },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    await new ConfiguredModelPresetDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: "interaction-default",
      displayName: "Interaction Default",
      providerKey: "openai",
      modelId: "gpt-4.1",
      options: { reasoning_effort: "low" },
    });
    await new ExecutionProfileModelAssignmentDal(container.db).upsertMany({
      tenantId: DEFAULT_TENANT_ID,
      assignments: [{ executionProfileId: "interaction", presetKey: "interaction-default" }],
    });

    const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({
      container,
      agentId: "agent-1",
      tenantId: DEFAULT_TENANT_ID,
      fetchImpl,
      secretProvider,
    });

    const model = await (
      runtime as unknown as {
        resolveSessionModel: (args: unknown) => Promise<LanguageModelV3>;
      }
    ).resolveSessionModel({
      config: {
        model: {
          model: "openai/gpt-4.1",
          options: { reasoning_effort: "high" },
        },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-assigned",
      executionProfileId: "interaction",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenProviderInputs.length).toBeGreaterThan(0);
    expect(
      seenProviderInputs.every((input) => input.options?.["reasoning_effort"] === "high"),
    ).toBe(true);
  });
});
