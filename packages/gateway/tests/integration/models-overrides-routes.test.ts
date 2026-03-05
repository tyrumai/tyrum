import { describe, it, expect } from "vitest";
import { createTestApp } from "./helpers.js";

describe("Models.dev + catalog override routes integration", () => {
  it("serves providers and models from the effective catalog", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const status = await app.request("/models/status");
    expect(status.status).toBe(200);

    const refresh = await app.request("/models/refresh", { method: "POST" });
    expect(refresh.status).toBe(200);

    const providersRes = await app.request("/models/providers");
    expect(providersRes.status).toBe(200);
    const providersBody = (await providersRes.json()) as {
      providers: Array<{ id: string; model_count: number }>;
    };
    expect(providersBody.providers.some((p) => p.id === "openai")).toBe(true);

    const missingProvider = await app.request("/models/providers/not-a-provider");
    expect(missingProvider.status).toBe(404);

    const modelsRes = await app.request("/models/providers/openai/models");
    expect(modelsRes.status).toBe(200);
    const modelsBody = (await modelsRes.json()) as { models: Array<{ id: string }> };
    expect(modelsBody.models.length).toBeGreaterThan(0);
  });

  it("supports tenant-scoped provider + model overrides", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const emptyProviders = await app.request("/models/overrides/providers");
    expect(emptyProviders.status).toBe(200);
    const emptyBody = (await emptyProviders.json()) as { overrides: unknown[] };
    expect(emptyBody.overrides).toHaveLength(0);

    const invalidProviderBody = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("nope"),
    });
    expect(invalidProviderBody.status).toBe(400);

    const invalidEnabled = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "true" }),
    });
    expect(invalidEnabled.status).toBe(400);

    const invalidOptions = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: "bad" }),
    });
    expect(invalidOptions.status).toBe(400);

    const invalidHeaders = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers: "bad" }),
    });
    expect(invalidHeaders.status).toBe(400);

    const putProvider = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        name: "OpenAI",
        npm: "openai",
        api: "https://example.invalid",
        doc: "https://docs.example.invalid",
        options: { baseURL: "https://api.example.invalid" },
        headers: { "X-Test": "abc" },
      }),
    });
    expect(putProvider.status).toBe(200);
    const putProviderBody = (await putProvider.json()) as {
      override: { provider_id: string; enabled: boolean; name: string | null };
    };
    expect(putProviderBody.override.provider_id).toBe("openai");
    expect(putProviderBody.override.enabled).toBe(false);

    const defaultBody = await app.request("/models/overrides/providers/openai", {
      method: "PUT",
    });
    expect(defaultBody.status).toBe(200);

    const listProviders = await app.request("/models/overrides/providers");
    expect(listProviders.status).toBe(200);
    const listProvidersBody = (await listProviders.json()) as {
      overrides: Array<{ enabled: boolean }>;
    };
    expect(listProvidersBody.overrides).toHaveLength(1);

    const emptyModels = await app.request("/models/overrides/providers/openai/models");
    expect(emptyModels.status).toBe(200);
    const emptyModelsBody = (await emptyModels.json()) as { overrides: unknown[] };
    expect(emptyModelsBody.overrides).toHaveLength(0);

    const invalidModelBody = await app.request(
      "/models/overrides/providers/openai/models/gpt-4.1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("nope"),
      },
    );
    expect(invalidModelBody.status).toBe(400);

    const invalidModalities = await app.request(
      "/models/overrides/providers/openai/models/gpt-4.1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modalities: "bad" }),
      },
    );
    expect(invalidModalities.status).toBe(400);

    const invalidLimit = await app.request("/models/overrides/providers/openai/models/gpt-4.1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: "bad" }),
    });
    expect(invalidLimit.status).toBe(400);

    const invalidModelHeaders = await app.request(
      "/models/overrides/providers/openai/models/gpt-4.1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: "bad" }),
      },
    );
    expect(invalidModelHeaders.status).toBe(400);

    const putModel = await app.request("/models/overrides/providers/openai/models/gpt-4.1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        name: "GPT-4.1",
        modalities: null,
        limit: null,
        provider_api: null,
        provider_npm: null,
        options: { temperature: 0.1 },
        headers: { "X-Model": "override" },
      }),
    });
    expect(putModel.status).toBe(200);
    const putModelBody = (await putModel.json()) as {
      override: { provider_id: string; model_id: string; enabled: boolean };
    };
    expect(putModelBody.override.provider_id).toBe("openai");
    expect(putModelBody.override.model_id).toBe("gpt-4.1");
    expect(putModelBody.override.enabled).toBe(false);

    const deleteModel = await app.request("/models/overrides/providers/openai/models/gpt-4.1", {
      method: "DELETE",
    });
    expect(deleteModel.status).toBe(200);

    const deleteModelMissing = await app.request(
      "/models/overrides/providers/openai/models/gpt-4.1",
      { method: "DELETE" },
    );
    expect(deleteModelMissing.status).toBe(404);

    const deleteProvider = await app.request("/models/overrides/providers/openai", {
      method: "DELETE",
    });
    expect(deleteProvider.status).toBe(200);

    const deleteProviderMissing = await app.request("/models/overrides/providers/openai", {
      method: "DELETE",
    });
    expect(deleteProviderMissing.status).toBe(404);
  });
});
