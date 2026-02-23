/**
 * Models.dev catalog routes — provider/model discovery and refresh controls.
 */

import { Hono } from "hono";
import type { ModelsDevService } from "../modules/models/models-dev-service.js";

export interface ModelsDevRouteDeps {
  modelsDev: ModelsDevService;
}

export function createModelsDevRoutes(deps: ModelsDevRouteDeps): Hono {
  const app = new Hono();

  app.get("/models/status", async (c) => {
    const loaded = await deps.modelsDev.ensureLoaded();
    return c.json({ status: "ok", models_dev: loaded.status });
  });

  app.post("/models/refresh", async (c) => {
    const loaded = await deps.modelsDev.refreshNow();
    return c.json({ status: "ok", models_dev: loaded.status });
  });

  app.get("/models/providers", async (c) => {
    const loaded = await deps.modelsDev.ensureLoaded();

    const providers = Object.values(loaded.catalog)
      .map((provider) => {
        const modelCount = Object.keys(provider.models ?? {}).length;
        return {
          id: provider.id,
          name: provider.name,
          npm: provider.npm ?? null,
          api: provider.api ?? null,
          env: provider.env ?? [],
          doc: (provider as { doc?: string }).doc ?? null,
          model_count: modelCount,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    return c.json({
      status: "ok",
      models_dev: loaded.status,
      providers,
    });
  });

  app.get("/models/providers/:id", async (c) => {
    const providerId = c.req.param("id");
    const loaded = await deps.modelsDev.ensureLoaded();
    const provider = loaded.catalog[providerId];
    if (!provider) {
      return c.json({ error: "not_found", message: `provider '${providerId}' not found` }, 404);
    }

    return c.json({
      status: "ok",
      models_dev: loaded.status,
      provider,
    });
  });

  app.get("/models/providers/:id/models", async (c) => {
    const providerId = c.req.param("id");
    const loaded = await deps.modelsDev.ensureLoaded();
    const provider = loaded.catalog[providerId];
    if (!provider) {
      return c.json({ error: "not_found", message: `provider '${providerId}' not found` }, 404);
    }

    const models = Object.values(provider.models ?? {})
      .map((model) => ({
        id: model.id,
        name: model.name,
        family: model.family ?? null,
        release_date: model.release_date ?? null,
        last_updated: (model as { last_updated?: string }).last_updated ?? null,
        attachment: model.attachment ?? null,
        reasoning: model.reasoning ?? null,
        tool_call: model.tool_call ?? null,
        modalities: model.modalities ?? null,
        limit: model.limit ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return c.json({
      status: "ok",
      models_dev: loaded.status,
      provider: {
        id: provider.id,
        name: provider.name,
        npm: provider.npm ?? null,
      },
      models,
    });
  });

  return app;
}

