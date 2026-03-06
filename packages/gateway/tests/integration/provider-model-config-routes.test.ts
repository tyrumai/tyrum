import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

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

describe("provider + model config routes", () => {
  it("lists registry entries and supports provider account CRUD", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(new ModelsDevCacheDal(container.db), {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        npm: "@ai-sdk/anthropic",
        api: "https://api.anthropic.com/v1",
        doc: "https://docs.anthropic.com",
        models: {
          "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
        },
      },
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
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method_key: "api_key",
        }),
      ]),
    );
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

    const createRes = await app.request("/config/providers/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_key: "anthropic",
        display_name: "Primary Anthropic",
        method_key: "api_key",
        config: {},
        secrets: {
          api_key: "sk-test-1",
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      account: {
        account_key: string;
        display_name: string;
        configured_secret_keys: string[];
      };
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
        headers: { "content-type": "application/json" },
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
    await seedCatalog(new ModelsDevCacheDal(container.db), {
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        doc: "https://platform.openai.com/docs",
        models: {
          "gpt-4.1": {
            id: "gpt-4.1",
            name: "GPT-4.1",
            modalities: { output: ["text"] },
            reasoning: true,
          },
          "gpt-4.1-mini": {
            id: "gpt-4.1-mini",
            name: "GPT-4.1 Mini",
            modalities: { output: ["text"] },
            reasoning: true,
          },
        },
      },
    });

    const accountRes = await app.request("/config/providers/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_key: "openai",
        display_name: "Primary OpenAI",
        method_key: "api_key",
        config: {},
        secrets: {
          api_key: "sk-test-2",
        },
      }),
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

    const presetARes = await app.request("/config/models/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Interaction Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
        options: { reasoning_effort: "medium" },
      }),
    });
    expect(presetARes.status).toBe(201);
    const presetA = (await presetARes.json()) as {
      preset: { preset_key: string; provider_key: string; model_id: string };
    };

    const presetBRes = await app.request("/config/models/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Fallback Default",
        provider_key: "openai",
        model_id: "gpt-4.1-mini",
        options: { reasoning_effort: "high" },
      }),
    });
    expect(presetBRes.status).toBe(201);
    const presetB = (await presetBRes.json()) as {
      preset: { preset_key: string };
    };

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
        headers: { "content-type": "application/json" },
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

  it("returns 400 when assignments reference a missing preset", async () => {
    const { app } = await createTestApp();

    const assignmentsRes = await app.request("/config/models/assignments", {
      method: "PUT",
      headers: { "content-type": "application/json" },
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
    await seedCatalog(new ModelsDevCacheDal(container.db), {
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        doc: "https://platform.openai.com/docs",
        models: {
          "gpt-4.1": {
            id: "gpt-4.1",
            name: "GPT-4.1",
            modalities: { output: ["text"] },
          },
        },
      },
    });

    const accountRes = await app.request("/config/providers/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_key: "openai",
        display_name: "Primary OpenAI",
        method_key: "api_key",
        config: {},
        secrets: {
          api_key: "sk-test-last-account",
        },
      }),
    });
    expect(accountRes.status).toBe(201);
    const created = (await accountRes.json()) as {
      account: { account_key: string };
    };

    const presetRes = await app.request("/config/models/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Interaction Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
        options: {},
      }),
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
    await seedCatalog(new ModelsDevCacheDal(container.db), {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        npm: "@ai-sdk/anthropic",
        api: "https://api.anthropic.com/v1",
        doc: "https://docs.anthropic.com",
        models: {
          "claude-3.5-sonnet": {
            id: "claude-3.5-sonnet",
            name: "Claude 3.5 Sonnet",
            modalities: { output: ["text"] },
          },
        },
      },
    });

    const accountRes = await app.request("/config/providers/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_key: "anthropic",
        display_name: "Primary Anthropic",
        method_key: "api_key",
        config: {},
        secrets: {
          api_key: "sk-test-direct-override",
        },
      }),
    });
    expect(accountRes.status).toBe(201);

    const session = await container.sessionDal.getOrCreate({
      scopeKeys: { tenantKey: "default", agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-direct",
      containerKind: "dm",
    });
    await container.db.run(
      `INSERT INTO session_model_overrides (
         tenant_id,
         session_id,
         model_id,
         preset_key,
         pinned_at,
         updated_at
       ) VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'))`,
      [DEFAULT_TENANT_ID, session.session_id, "anthropic/claude-3.5-sonnet"],
    );

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

    await container.db.run(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         auth_profile_key,
         provider_key,
         type,
         status
       ) VALUES (?, ?, ?, ?, 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, randomUUID(), "wildcard-account", wildcardProviderKey],
    );
    await container.db.run(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         auth_profile_key,
         provider_key,
         type,
         status
       ) VALUES (?, ?, ?, ?, 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, randomUUID(), "other-account", otherProviderKey],
    );

    const wildcardSession = await container.sessionDal.getOrCreate({
      scopeKeys: { tenantKey: "default", agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-wildcard",
      containerKind: "dm",
    });
    const otherSession = await container.sessionDal.getOrCreate({
      scopeKeys: { tenantKey: "default", agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-other",
      containerKind: "dm",
    });

    await container.db.run(
      `INSERT INTO session_model_overrides (
         tenant_id,
         session_id,
         model_id,
         preset_key,
         pinned_at,
         updated_at
       ) VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'))`,
      [DEFAULT_TENANT_ID, wildcardSession.session_id, `${wildcardProviderKey}/gpt-4.1`],
    );
    await container.db.run(
      `INSERT INTO session_model_overrides (
         tenant_id,
         session_id,
         model_id,
         preset_key,
         pinned_at,
         updated_at
       ) VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'))`,
      [DEFAULT_TENANT_ID, otherSession.session_id, `${otherProviderKey}/gpt-4.1`],
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
