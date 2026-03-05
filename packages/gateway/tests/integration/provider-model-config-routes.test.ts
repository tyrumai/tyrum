import { describe, expect, it } from "vitest";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
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
      openai: {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        doc: "https://platform.openai.com/docs",
        models: {
          "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
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
    expect(registryBody.providers.some((provider) => provider.provider_key === "openai")).toBe(
      true,
    );
    expect(
      registryBody.providers.find((provider) => provider.provider_key === "openai")?.methods,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method_key: "api_key",
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
        provider_key: "openai",
        display_name: "Primary OpenAI",
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
    expect(created.account.display_name).toBe("Primary OpenAI");
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
          provider_key: "openai",
          accounts: [
            expect.objectContaining({
              account_key: created.account.account_key,
              display_name: "Primary OpenAI",
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
          display_name: "Renamed OpenAI",
          config: { baseURL: "https://example.test/v1" },
        }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as {
      account: { display_name: string; config: Record<string, unknown> };
    };
    expect(updated.account.display_name).toBe("Renamed OpenAI");
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
});
