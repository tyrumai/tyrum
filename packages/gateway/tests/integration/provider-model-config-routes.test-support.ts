import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { createTestApp } from "./helpers.js";

export const jsonHeaders = { "content-type": "application/json" };

export const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export const defaultSessionScope = {
  tenantKey: "default",
  agentKey: "default",
  workspaceKey: "default",
};

export const PROVIDER_METADATA = {
  anthropic: {
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    api: "https://api.anthropic.com/v1",
    doc: "https://docs.anthropic.com",
  },
  openai: {
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    doc: "https://platform.openai.com/docs",
  },
  openrouter: {
    name: "OpenRouter",
    env: ["OPENROUTER_API_KEY"],
    npm: "@openrouter/ai-sdk-provider",
    api: "https://openrouter.ai/api/v1",
    doc: "https://openrouter.ai/docs/api-reference/overview",
  },
} satisfies Record<string, Record<string, unknown>>;

export async function seedCatalog(
  cacheDal: ModelsDevCacheDal,
  catalog: Record<string, unknown>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await cacheDal.upsert({
    fetchedAt: nowIso,
    etag: null,
    sha256: "sha-test",
    json: JSON.stringify(catalog),
    source: "remote",
    lastError: null,
    nowIso,
  });
}

export function modelResponse(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, name, modalities: { output: ["text"] }, ...extra };
}

export function catalogFor(
  providerKey: keyof typeof PROVIDER_METADATA,
  models: Record<string, unknown>,
): Record<string, unknown> {
  return { [providerKey]: { id: providerKey, ...PROVIDER_METADATA[providerKey], models } };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function createProviderAccount(
  app: TestApp["app"],
  body: Record<string, unknown>,
): Promise<Response> {
  return await app.request("/config/providers/accounts", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export async function createModelPreset(
  app: TestApp["app"],
  body: Record<string, unknown>,
): Promise<Response> {
  return await app.request("/config/models/presets", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

export async function createDefaultSession(
  container: TestApp["container"],
  providerThreadId: string,
) {
  return await container.sessionDal.getOrCreate({
    scopeKeys: defaultSessionScope,
    connectorKey: "ui",
    providerThreadId,
    containerKind: "dm",
  });
}

export async function insertApiKeyProfile(
  container: TestApp["container"],
  authProfileKey: string,
  providerKey: string,
): Promise<void> {
  await container.db.run(
    `INSERT INTO auth_profiles (
       tenant_id,
       auth_profile_id,
       auth_profile_key,
       provider_key,
       type,
       status
     ) VALUES (?, ?, ?, ?, 'api_key', 'active')`,
    [DEFAULT_TENANT_ID, randomUUID(), authProfileKey, providerKey],
  );
}

export async function insertSessionModelOverride(
  container: TestApp["container"],
  sessionId: string,
  modelId: string,
): Promise<void> {
  await container.db.run(
    `INSERT INTO session_model_overrides (
       tenant_id,
       session_id,
       model_id,
       preset_key,
       pinned_at,
       updated_at
     ) VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'))`,
    [DEFAULT_TENANT_ID, sessionId, modelId],
  );
}

export { ModelsDevCacheDal, DEFAULT_TENANT_ID };
