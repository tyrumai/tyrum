import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

const jsonHeaders = { "content-type": "application/json" };
const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;
const defaultSessionScope = { tenantKey: "default", agentKey: "default", workspaceKey: "default" };
const PROVIDER_METADATA = {
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

async function seedCatalog(
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

function modelResponse(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, name, modalities: { output: ["text"] }, ...extra };
}

function catalogFor(
  providerKey: keyof typeof PROVIDER_METADATA,
  models: Record<string, unknown>,
): Record<string, unknown> {
  return { [providerKey]: { id: providerKey, ...PROVIDER_METADATA[providerKey], models } };
}

async function createProviderAccount(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  body: Record<string, unknown>,
): Promise<Response> {
  return await app.request("/config/providers/accounts", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

async function createModelPreset(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  body: Record<string, unknown>,
): Promise<Response> {
  return await app.request("/config/models/presets", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

async function createDefaultSession(
  container: Awaited<ReturnType<typeof createTestApp>>["container"],
  providerThreadId: string,
) {
  return await container.sessionDal.getOrCreate({
    scopeKeys: defaultSessionScope,
    connectorKey: "ui",
    providerThreadId,
    containerKind: "dm",
  });
}

async function insertApiKeyProfile(
  container: Awaited<ReturnType<typeof createTestApp>>["container"],
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

async function insertSessionModelOverride(
  container: Awaited<ReturnType<typeof createTestApp>>["container"],
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

describe("provider + model config routes", () => {
  it("lists registry entries and supports provider account CRUD", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(new ModelsDevCacheDal(container.db), {
      ...catalogFor("anthropic", {
        "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
      }),
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
      unsupported: {
        id: "unsupported",
        name: "Unsupported",
        env: [],
        npm: "@ai-sdk/unsupported",
        models: {},
      },
    });

    const registryRes = await app.request("/config/providers/registry");
    expect(registryRes.status).toBe(200);
    const registryBody = (await registryRes.json()) as {
      providers: Array<{
        provider_key: string;
        supported: boolean;
        methods: Array<{ method_key: string }>;
      }>;
    };
    expect(registryBody.providers.some((provider) => provider.provider_key === "anthropic")).toBe(
      true,
    );
    expect(
      registryBody.providers.find((provider) => provider.provider_key === "anthropic")?.methods,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ method_key: "api_key" })]));
    expect(
      registryBody.providers.find((provider) => provider.provider_key === "cloudflare-workers-ai")
        ?.supported,
    ).toBe(true);
    expect(
      registryBody.providers.find((provider) => provider.provider_key === "cloudflare-workers-ai")
        ?.methods,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method_key: "api_key",
          fields: expect.arrayContaining([
            expect.objectContaining({ key: "api_key" }),
            expect.objectContaining({ key: "baseURL" }),
            expect.objectContaining({ key: "CLOUDFLARE_ACCOUNT_ID" }),
          ]),
        }),
      ]),
    );
    expect(
      registryBody.providers.find((provider) => provider.provider_key === "unsupported")?.supported,
    ).toBe(false);

    const createRes = await createProviderAccount(app, {
      provider_key: "anthropic",
      display_name: "Primary Anthropic",
      method_key: "api_key",
      config: {},
      secrets: {
        api_key: "sk-test-1",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      account: { account_key: string; display_name: string; configured_secret_keys: string[] };
    };
    expect(created.account.account_key).toBeTypeOf("string");
    expect(created.account.display_name).toBe("Primary Anthropic");
    expect(created.account.configured_secret_keys).toEqual(["api_key"]);

    const listRes = await app.request("/config/providers");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      providers: Array<{
        provider_key: string;
        accounts: Array<{
          account_key: string;
          display_name: string;
          configured_secret_keys: string[];
        }>;
      }>;
    };
    expect(listed.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_key: "anthropic",
          accounts: [
            expect.objectContaining({
              account_key: created.account.account_key,
              display_name: "Primary Anthropic",
              configured_secret_keys: ["api_key"],
            }),
          ],
        }),
      ]),
    );

    const updateRes = await app.request(
      `/config/providers/accounts/${encodeURIComponent(created.account.account_key)}`,
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({
          display_name: "Renamed Anthropic",
          config: { baseURL: "https://example.test/v1" },
        }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as {
      account: { display_name: string; config: Record<string, unknown> };
    };
    expect(updated.account.display_name).toBe("Renamed Anthropic");
    expect(updated.account.config["baseURL"]).toBe("https://example.test/v1");

    const deleteRes = await app.request(
      `/config/providers/accounts/${encodeURIComponent(created.account.account_key)}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteRes.status).toBe(200);
  });

  it("creates model presets, updates assignments, and requires replacements on delete", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(
      new ModelsDevCacheDal(container.db),
      catalogFor("openai", {
        "gpt-4.1": modelResponse("gpt-4.1", "GPT-4.1", { reasoning: true }),
        "gpt-4.1-mini": modelResponse("gpt-4.1-mini", "GPT-4.1 Mini", { reasoning: true }),
      }),
    );

    const accountRes = await createProviderAccount(app, {
      provider_key: "openai",
      display_name: "Primary OpenAI",
      method_key: "api_key",
      config: {},
      secrets: {
        api_key: "sk-test-2",
      },
    });
    expect(accountRes.status).toBe(201);

    const availableRes = await app.request("/config/models/presets/available");
    expect(availableRes.status).toBe(200);
    const available = (await availableRes.json()) as {
      models: Array<{ provider_key: string; model_id: string }>;
    };
    expect(available.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider_key: "openai", model_id: "gpt-4.1" }),
        expect.objectContaining({ provider_key: "openai", model_id: "gpt-4.1-mini" }),
      ]),
    );

    const presetARes = await createModelPreset(app, {
      display_name: "Interaction Default",
      provider_key: "openai",
      model_id: "gpt-4.1",
      options: { reasoning_effort: "medium" },
    });
    expect(presetARes.status).toBe(201);
    const presetA = (await presetARes.json()) as {
      preset: { preset_key: string; provider_key: string; model_id: string };
    };

    const presetBRes = await createModelPreset(app, {
      display_name: "Fallback Default",
      provider_key: "openai",
      model_id: "gpt-4.1-mini",
      options: { reasoning_effort: "high" },
    });
    expect(presetBRes.status).toBe(201);
    const presetB = (await presetBRes.json()) as { preset: { preset_key: string } };

    const assignmentsRes = await app.request("/config/models/assignments", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assignments: Object.fromEntries(
          EXECUTION_PROFILE_IDS.map((profileId) => [profileId, presetA.preset.preset_key]),
        ),
      }),
    });
    expect(assignmentsRes.status).toBe(200);

    const blockedDeleteRes = await app.request(
      `/config/models/presets/${encodeURIComponent(presetA.preset.preset_key)}`,
      {
        method: "DELETE",
      },
    );
    expect(blockedDeleteRes.status).toBe(409);
    const blockedDelete = (await blockedDeleteRes.json()) as {
      error: string;
      required_execution_profile_ids: string[];
    };
    expect(blockedDelete.error).toBe("assignment_required");
    expect(blockedDelete.required_execution_profile_ids).toContain("interaction");

    const deleteRes = await app.request(
      `/config/models/presets/${encodeURIComponent(presetA.preset.preset_key)}`,
      {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({
          replacement_assignments: Object.fromEntries(
            EXECUTION_PROFILE_IDS.map((profileId) => [profileId, presetB.preset.preset_key]),
          ),
        }),
      },
    );
    expect(deleteRes.status).toBe(200);

    const listAssignmentsRes = await app.request("/config/models/assignments");
    expect(listAssignmentsRes.status).toBe(200);
    const listAssignments = (await listAssignmentsRes.json()) as {
      assignments: Array<{ execution_profile_id: string; preset_key: string }>;
    };
    expect(
      listAssignments.assignments.every(
        (assignment) => assignment.preset_key === presetB.preset.preset_key,
      ),
    ).toBe(true);
  });

  it("normalizes legacy self-prefixed OpenRouter model ids in available and preset routes", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(
      new ModelsDevCacheDal(container.db),
      catalogFor("openrouter", {
        "openrouter/openai/gpt-5.4": modelResponse("openrouter/openai/gpt-5.4", "GPT-5.4", {
          reasoning: true,
          tool_call: true,
        }),
      }),
    );

    await insertApiKeyProfile(container, "openrouter-primary", "openrouter");

    const nowIso = "2026-03-01T00:00:00.000Z";
    await container.db.run(
      `INSERT INTO configured_model_presets (
         tenant_id,
         preset_id,
         preset_key,
         display_name,
         provider_key,
         model_id,
         options_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        randomUUID(),
        "legacy-openrouter",
        "Legacy OpenRouter",
        "openrouter",
        "openrouter/openai/gpt-5.4",
        "{}",
        nowIso,
        nowIso,
      ],
    );

    const availableRes = await app.request("/config/models/presets/available");
    expect(availableRes.status).toBe(200);
    const available = (await availableRes.json()) as {
      models: Array<{ provider_key: string; model_id: string }>;
    };
    expect(available.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider_key: "openrouter", model_id: "openai/gpt-5.4" }),
      ]),
    );

    const presetListRes = await app.request("/config/models/presets");
    expect(presetListRes.status).toBe(200);
    const presetList = (await presetListRes.json()) as {
      presets: Array<{ preset_key: string; model_id: string }>;
    };
    expect(presetList.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preset_key: "legacy-openrouter", model_id: "openai/gpt-5.4" }),
      ]),
    );

    const createRes = await createModelPreset(app, {
      display_name: "GPT-5.4",
      provider_key: "openrouter",
      model_id: "openai/gpt-5.4",
      options: {},
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      preset: { provider_key: string; model_id: string };
    };
    expect(created.preset).toEqual(
      expect.objectContaining({ provider_key: "openrouter", model_id: "openai/gpt-5.4" }),
    );
  });

  it("returns 400 when assignments reference a missing preset", async () => {
    const { app } = await createTestApp();

    const assignmentsRes = await app.request("/config/models/assignments", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        assignments: Object.fromEntries(
          EXECUTION_PROFILE_IDS.map((profileId) => [profileId, "missing-preset"]),
        ),
      }),
    });

    expect(assignmentsRes.status).toBe(400);
    const body = (await assignmentsRes.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("missing-preset");
  });

  it("blocks deleting the last provider account while presets still reference the provider", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(
      new ModelsDevCacheDal(container.db),
      catalogFor("openai", {
        "gpt-4.1": modelResponse("gpt-4.1", "GPT-4.1"),
      }),
    );

    const accountRes = await createProviderAccount(app, {
      provider_key: "openai",
      display_name: "Primary OpenAI",
      method_key: "api_key",
      config: {},
      secrets: {
        api_key: "sk-test-last-account",
      },
    });
    expect(accountRes.status).toBe(201);
    const created = (await accountRes.json()) as { account: { account_key: string } };

    const presetRes = await createModelPreset(app, {
      display_name: "Interaction Default",
      provider_key: "openai",
      model_id: "gpt-4.1",
      options: {},
    });
    expect(presetRes.status).toBe(201);

    const deleteRes = await app.request(
      `/config/providers/accounts/${encodeURIComponent(created.account.account_key)}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteRes.status).toBe(409);
    const deleteBody = (await deleteRes.json()) as { message: string };
    expect(deleteBody.message).toContain("last provider account");

    const remaining = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM auth_profiles
       WHERE tenant_id = ? AND provider_key = ?`,
      [DEFAULT_TENANT_ID, "openai"],
    );
    expect(remaining?.count).toBe(1);
  });

  it("removes direct session model overrides when deleting a provider", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(
      new ModelsDevCacheDal(container.db),
      catalogFor("anthropic", {
        "claude-3.5-sonnet": modelResponse("claude-3.5-sonnet", "Claude 3.5 Sonnet"),
      }),
    );

    const accountRes = await createProviderAccount(app, {
      provider_key: "anthropic",
      display_name: "Primary Anthropic",
      method_key: "api_key",
      config: {},
      secrets: {
        api_key: "sk-test-direct-override",
      },
    });
    expect(accountRes.status).toBe(201);

    const session = await createDefaultSession(container, "thread-direct");
    await insertSessionModelOverride(container, session.session_id, "anthropic/claude-3.5-sonnet");

    const deleteRes = await app.request("/config/providers/anthropic", {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    const override = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM session_model_overrides
       WHERE tenant_id = ? AND model_id = ?`,
      [DEFAULT_TENANT_ID, "anthropic/claude-3.5-sonnet"],
    );
    expect(override?.count).toBe(0);
  });

  it("escapes provider keys when deleting direct session model overrides", async () => {
    const { app, container } = await createTestApp();
    const wildcardProviderKey = "open_ai";
    const otherProviderKey = "openxai";

    await insertApiKeyProfile(container, "wildcard-account", wildcardProviderKey);
    await insertApiKeyProfile(container, "other-account", otherProviderKey);

    const wildcardSession = await createDefaultSession(container, "thread-wildcard");
    const otherSession = await createDefaultSession(container, "thread-other");

    await insertSessionModelOverride(
      container,
      wildcardSession.session_id,
      `${wildcardProviderKey}/gpt-4.1`,
    );
    await insertSessionModelOverride(
      container,
      otherSession.session_id,
      `${otherProviderKey}/gpt-4.1`,
    );

    const deleteRes = await app.request(
      `/config/providers/${encodeURIComponent(wildcardProviderKey)}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteRes.status).toBe(200);

    const overrides = await container.db.all<{ model_id: string }>(
      `SELECT model_id
       FROM session_model_overrides
       WHERE tenant_id = ?
       ORDER BY model_id ASC`,
      [DEFAULT_TENANT_ID],
    );
    expect(overrides).toEqual([{ model_id: `${otherProviderKey}/gpt-4.1` }]);
  });
});
