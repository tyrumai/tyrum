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
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
  config?: Record<string, unknown>;
  secrets?: Record<string, string | undefined>;
}> = [];

vi.mock("../../src/modules/models/provider-factory.js", () => {
  return {
    createProviderFromNpm: (input: {
      providerId: string;
      apiKey?: string;
      baseURL?: string;
      headers?: Record<string, string>;
      options?: Record<string, unknown>;
      config?: Record<string, unknown>;
      secrets?: Record<string, string | undefined>;
    }) => {
      seenProviderInputs.push({
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        headers: input.headers,
        options: input.options,
        config: input.config,
        secrets: input.secrets,
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

  it("uses provider account baseURL over the catalog endpoint when the account sets one", async () => {
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
      config: { baseURL: "https://account.example/v1" },
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
      sessionId: "session-account-baseurl",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenProviderInputs.length).toBeGreaterThan(0);
    expect(
      seenProviderInputs.every((input) => input.baseURL === "https://account.example/v1"),
    ).toBe(true);
  });

  it("interpolates catalog URL templates from provider account config", async () => {
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
    await secretProvider.store("cloudflare_api_key", "cf-key");
    await new AuthProfileDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "cloudflare-workers-ai",
      type: "api_key",
      config: {
        CLOUDFLARE_ACCOUNT_ID: "account-123",
      },
      secretKeys: { api_key: "cloudflare_api_key" },
    });

    const cacheDal = new ModelsDevCacheDal(container.db);
    const nowIso = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: null,
      sha256: "sha",
      json: JSON.stringify({
        "cloudflare-workers-ai": {
          id: "cloudflare-workers-ai",
          name: "Cloudflare Workers AI",
          env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
          models: {
            "@cf/meta/llama-3.1-8b-instruct": {
              id: "@cf/meta/llama-3.1-8b-instruct",
              name: "Llama 3.1 8B Instruct",
            },
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
        model: { model: "cloudflare-workers-ai/@cf/meta/llama-3.1-8b-instruct", options: {} },
      },
      tenantId: DEFAULT_TENANT_ID,
      sessionId: "session-cloudflare-template",
      fetchImpl,
    });

    await model.doGenerate({} as any);

    expect(seenProviderInputs.length).toBeGreaterThan(0);
    expect(seenProviderInputs[0]?.baseURL).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1",
    );
    expect(seenProviderInputs[0]?.apiKey).toBe("cf-key");
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
