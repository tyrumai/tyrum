import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { DbSecretProvider } from "../../src/modules/secret/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const providerFixtures = {
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
  gitlab: {
    id: "gitlab",
    name: "GitLab",
    env: ["GITLAB_TOKEN"],
    npm: "@gitlab/gitlab-ai-provider",
    models: { "duo-chat": { id: "duo-chat", name: "Duo Chat" } },
  },
} as const;

type ProviderFixtureId = keyof typeof providerFixtures;

type ResolveSessionModelArgs = {
  model: string;
  fallback?: string[];
  sessionId: string;
  executionProfileId?: string;
  profileModelId?: string;
  fetchImpl?: typeof fetch;
};

type ConfiguredPresetInput = {
  presetKey: string;
  displayName: string;
  providerKey: string;
  modelId: string;
  options?: Record<string, unknown>;
};

export const notFoundFetch: typeof fetch = async () => new Response("not found", { status: 404 });

export function createTestContainer(): GatewayContainer {
  return createContainer({
    dbPath: ":memory:",
    migrationsDir,
  });
}

export async function seedModelsDevCache(
  container: GatewayContainer,
  providerIds: ProviderFixtureId[],
): Promise<void> {
  const catalog: Record<string, unknown> = {};
  for (const providerId of providerIds) {
    catalog[providerId] = providerFixtures[providerId];
  }

  const nowIso = new Date().toISOString();
  await new ModelsDevCacheDal(container.db).upsert({
    fetchedAt: nowIso,
    etag: null,
    sha256: "sha",
    json: JSON.stringify(catalog),
    source: "remote",
    lastError: null,
    nowIso,
  });
}

async function seedAuthProfiles(container: GatewayContainer): Promise<DbSecretProvider> {
  const secretProvider = new DbSecretProvider(container.db, {
    tenantId: DEFAULT_TENANT_ID,
    masterKey: Buffer.alloc(32, 7),
    keyId: "test-key",
  });
  await secretProvider.store("api-key:openai", "openai-key");
  await secretProvider.store("api-key:anthropic", "anthropic-key");

  const authProfileDal = new AuthProfileDal(container.db);
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

export async function createConfiguredPreset(
  container: GatewayContainer,
  input: ConfiguredPresetInput,
) {
  return await new ConfiguredModelPresetDal(container.db).create({
    tenantId: DEFAULT_TENANT_ID,
    presetKey: input.presetKey,
    displayName: input.displayName,
    providerKey: input.providerKey,
    modelId: input.modelId,
    options: input.options ?? {},
  });
}

export async function createAgentRuntime(
  container: GatewayContainer,
  options: {
    fetchImpl?: typeof fetch;
    withSecretProvider?: boolean;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? notFoundFetch;
  const secretProvider = options.withSecretProvider ? await seedAuthProfiles(container) : undefined;
  const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

  return new AgentRuntime({
    container,
    agentId: "agent-1",
    secretProvider,
    fetchImpl,
  });
}

export async function resolveSessionModel(
  runtime: unknown,
  args: ResolveSessionModelArgs,
): Promise<LanguageModelV3> {
  return await (
    runtime as {
      resolveSessionModel: (input: unknown) => Promise<LanguageModelV3>;
    }
  ).resolveSessionModel({
    config: {
      model: {
        model: args.model,
        fallback: args.fallback ?? [],
        options: {},
      },
    },
    tenantId: DEFAULT_TENANT_ID,
    sessionId: args.sessionId,
    executionProfileId: args.executionProfileId,
    profileModelId: args.profileModelId,
    fetchImpl: args.fetchImpl ?? notFoundFetch,
  });
}

export async function createUiSession(container: GatewayContainer, providerThreadId: string) {
  return await container.sessionDal.getOrCreate({
    scopeKeys: { tenantKey: "default", agentKey: "agent-1", workspaceKey: "default" },
    connectorKey: "ui",
    providerThreadId,
    containerKind: "dm",
  });
}
