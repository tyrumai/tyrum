import { Hono } from "hono";
import type { ModelCatalogService } from "../modules/model/catalog-service.js";

export interface CatalogRouteDeps {
  modelCatalog: ModelCatalogService;
}

export function createCatalogRoutes(deps: CatalogRouteDeps): Hono {
  const app = new Hono();
  const catalog = deps.modelCatalog;

  /** GET /models/catalog — list enabled providers with model counts */
  app.get("/models/catalog", async (c) => {
    if (!catalog.isLoaded || catalog.isStale) {
      await catalog.refresh();
    }
    const enabled = catalog.getEnabledProviders();
    return c.json({
      providers: enabled.map((p) => ({
        id: p.id,
        name: p.name,
        model_count: Object.keys(p.models).length,
      })),
      total_providers: catalog.listProviders().length,
      enabled_providers: enabled.length,
    });
  });

  /** GET /models/catalog/:modelId — get specific model info + limits */
  app.get("/models/catalog/:modelId", async (c) => {
    if (!catalog.isLoaded || catalog.isStale) {
      await catalog.refresh();
    }
    const modelId = c.req.param("modelId");
    const model = catalog.getModel(modelId);
    if (!model) {
      return c.json(
        { error: "not_found", message: `Model '${modelId}' not found in catalog` },
        404,
      );
    }
    return c.json(model);
  });

  return app;
}
