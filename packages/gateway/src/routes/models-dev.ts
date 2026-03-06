/**
 * Models.dev catalog routes — provider/model discovery and refresh controls.
 */

import { Hono } from "hono";
import type { ModelsDevService } from "../modules/models/models-dev-service.js";
import type { ModelCatalogService } from "../modules/models/model-catalog-service.js";
import { requireTenantId } from "../modules/auth/claims.js";
import { safeJsonParse } from "../utils/json.js";

export interface ModelsDevRouteDeps {
  modelsDev: ModelsDevService;
  modelCatalog: ModelCatalogService;
}

export function createModelsDevRoutes(deps: ModelsDevRouteDeps): Hono {
  const app = new Hono();

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  };

  const normalizeOptionalNullableString = (value: unknown): string | null | undefined => {
    if (typeof value === "undefined") return undefined;
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const normalizeOptionalNullableObject = (
    value: unknown,
  ): Record<string, unknown> | null | undefined => {
    if (typeof value === "undefined") return undefined;
    if (value === null) return null;
    if (!isRecord(value)) return undefined;
    return value;
  };

  const normalizeOptionalNullableStringRecord = (
    value: unknown,
  ): Record<string, string> | null | undefined => {
    const obj = normalizeOptionalNullableObject(value);
    if (obj === undefined) return undefined;
    if (obj === null) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string") continue;
      const key = k.trim();
      const val = v.trim();
      if (!key || !val) continue;
      out[key] = val;
    }
    return out;
  };

  app.get("/models/status", async (c) => {
    const loaded = await deps.modelsDev.ensureLoaded();
    return c.json({ status: "ok", models_dev: loaded.status });
  });

  app.post("/models/refresh", async (c) => {
    const loaded = await deps.modelsDev.refreshNow();
    return c.json({ status: "ok", models_dev: loaded.status });
  });

  app.get("/models/providers", async (c) => {
    const tenantId = requireTenantId(c);
    const loaded = await deps.modelCatalog.getEffectiveCatalog({ tenantId });

    const providers = Object.values(loaded.catalog)
      .map((provider) => {
        const enabled = (provider as { enabled?: boolean }).enabled ?? true;
        const modelCount = Object.values(provider.models ?? {}).filter(
          (m) => (m as { enabled?: boolean }).enabled ?? true,
        ).length;
        return {
          id: provider.id,
          name: provider.name,
          npm: provider.npm ?? null,
          api: provider.api ?? null,
          enabled,
          doc: (provider as { doc?: string }).doc ?? null,
          model_count: modelCount,
        };
      })
      .toSorted((a, b) => a.id.localeCompare(b.id));

    return c.json({
      status: "ok",
      models_dev: loaded.status,
      providers,
    });
  });

  app.get("/models/providers/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const loaded = await deps.modelCatalog.getEffectiveCatalog({ tenantId });
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
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const loaded = await deps.modelCatalog.getEffectiveCatalog({ tenantId });
    const provider = loaded.catalog[providerId];
    if (!provider) {
      return c.json({ error: "not_found", message: `provider '${providerId}' not found` }, 404);
    }

    const models = Object.values(provider.models ?? {})
      .map((model) => ({
        id: model.id,
        name: model.name,
        enabled: (model as { enabled?: boolean }).enabled ?? true,
        family: model.family ?? null,
        release_date: model.release_date ?? null,
        last_updated: (model as { last_updated?: string }).last_updated ?? null,
        attachment: model.attachment ?? null,
        reasoning: model.reasoning ?? null,
        tool_call: model.tool_call ?? null,
        modalities: model.modalities ?? null,
        limit: model.limit ?? null,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id));

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

  // --- Tenant catalog overrides (provider + model) ---

  app.get("/models/overrides/providers", async (c) => {
    const tenantId = requireTenantId(c);
    const rows = await deps.modelCatalog.overrides.listProviderOverrides({ tenantId });
    const overrides = rows.map((row) => ({
      provider_id: row.provider_id,
      enabled: row.enabled,
      name: row.name,
      npm: row.npm,
      api: row.api,
      doc: row.doc,
      options: safeJsonParse(row.options_json, {}),
      headers: safeJsonParse(row.headers_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    return c.json({ overrides });
  });

  app.put("/models/overrides/providers/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");

    const body = (await c.req.json().catch(() => undefined)) as unknown;
    if (body !== undefined && !isRecord(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }
    const data = (body ?? {}) as Record<string, unknown>;

    const existing = await deps.modelCatalog.overrides.getProviderOverride({
      tenantId,
      providerId,
    });

    const enabledRaw = Object.prototype.hasOwnProperty.call(data, "enabled")
      ? data["enabled"]
      : undefined;
    if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
      return c.json({ error: "invalid_request", message: "enabled must be a boolean" }, 400);
    }
    const enabled = typeof enabledRaw === "boolean" ? enabledRaw : (existing?.enabled ?? true);

    const name = Object.prototype.hasOwnProperty.call(data, "name")
      ? normalizeOptionalNullableString(data["name"])
      : (existing?.name ?? null);
    const npm = Object.prototype.hasOwnProperty.call(data, "npm")
      ? normalizeOptionalNullableString(data["npm"])
      : (existing?.npm ?? null);
    const api = Object.prototype.hasOwnProperty.call(data, "api")
      ? normalizeOptionalNullableString(data["api"])
      : (existing?.api ?? null);
    const doc = Object.prototype.hasOwnProperty.call(data, "doc")
      ? normalizeOptionalNullableString(data["doc"])
      : (existing?.doc ?? null);

    const optionsObj = Object.prototype.hasOwnProperty.call(data, "options")
      ? normalizeOptionalNullableObject(data["options"])
      : safeJsonParse(existing?.options_json, {});
    if (optionsObj === undefined) {
      return c.json(
        { error: "invalid_request", message: "options must be an object or null" },
        400,
      );
    }

    const headersObj = Object.prototype.hasOwnProperty.call(data, "headers")
      ? normalizeOptionalNullableStringRecord(data["headers"])
      : (safeJsonParse(existing?.headers_json, {}) as Record<string, string>);
    if (headersObj === undefined) {
      return c.json(
        { error: "invalid_request", message: "headers must be an object or null" },
        400,
      );
    }

    const row = await deps.modelCatalog.overrides.upsertProviderOverride({
      tenantId,
      providerId,
      enabled,
      name,
      npm,
      api,
      doc,
      optionsJson: JSON.stringify(optionsObj ?? {}),
      headersJson: JSON.stringify(headersObj ?? {}),
    });

    return c.json(
      {
        override: {
          provider_id: row.provider_id,
          enabled: row.enabled,
          name: row.name,
          npm: row.npm,
          api: row.api,
          doc: row.doc,
          options: safeJsonParse(row.options_json, {}),
          headers: safeJsonParse(row.headers_json, {}),
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      },
      200,
    );
  });

  app.delete("/models/overrides/providers/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const deleted = await deps.modelCatalog.overrides.deleteProviderOverride({
      tenantId,
      providerId,
    });
    return c.json({ deleted }, deleted ? 200 : 404);
  });

  app.get("/models/overrides/providers/:id/models", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const rows = await deps.modelCatalog.overrides.listModelOverrides({ tenantId, providerId });
    const overrides = rows.map((row) => ({
      provider_id: row.provider_id,
      model_id: row.model_id,
      enabled: row.enabled,
      name: row.name,
      family: row.family,
      release_date: row.release_date,
      last_updated: row.last_updated,
      modalities: safeJsonParse(row.modalities_json, undefined),
      limit: safeJsonParse(row.limit_json, undefined),
      provider_npm: row.provider_npm,
      provider_api: row.provider_api,
      options: safeJsonParse(row.options_json, {}),
      headers: safeJsonParse(row.headers_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    return c.json({ overrides });
  });

  app.put("/models/overrides/providers/:id/models/:model", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const modelId = c.req.param("model");

    const body = (await c.req.json().catch(() => undefined)) as unknown;
    if (body !== undefined && !isRecord(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }
    const data = (body ?? {}) as Record<string, unknown>;

    const existing = await deps.modelCatalog.overrides.getModelOverride({
      tenantId,
      providerId,
      modelId,
    });

    const enabledRaw = Object.prototype.hasOwnProperty.call(data, "enabled")
      ? data["enabled"]
      : undefined;
    if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
      return c.json({ error: "invalid_request", message: "enabled must be a boolean" }, 400);
    }
    const enabled = typeof enabledRaw === "boolean" ? enabledRaw : (existing?.enabled ?? true);

    const name = Object.prototype.hasOwnProperty.call(data, "name")
      ? normalizeOptionalNullableString(data["name"])
      : (existing?.name ?? null);
    const family = Object.prototype.hasOwnProperty.call(data, "family")
      ? normalizeOptionalNullableString(data["family"])
      : (existing?.family ?? null);
    const releaseDate = Object.prototype.hasOwnProperty.call(data, "release_date")
      ? normalizeOptionalNullableString(data["release_date"])
      : (existing?.release_date ?? null);
    const lastUpdated = Object.prototype.hasOwnProperty.call(data, "last_updated")
      ? normalizeOptionalNullableString(data["last_updated"])
      : (existing?.last_updated ?? null);

    const providerNpm = Object.prototype.hasOwnProperty.call(data, "provider_npm")
      ? normalizeOptionalNullableString(data["provider_npm"])
      : (existing?.provider_npm ?? null);
    const providerApi = Object.prototype.hasOwnProperty.call(data, "provider_api")
      ? normalizeOptionalNullableString(data["provider_api"])
      : (existing?.provider_api ?? null);

    const modalitiesObj = Object.prototype.hasOwnProperty.call(data, "modalities")
      ? normalizeOptionalNullableObject(data["modalities"])
      : undefined;
    if (Object.prototype.hasOwnProperty.call(data, "modalities") && modalitiesObj === undefined) {
      return c.json(
        { error: "invalid_request", message: "modalities must be an object or null" },
        400,
      );
    }
    const modalitiesJson =
      modalitiesObj === undefined
        ? (existing?.modalities_json ?? null)
        : modalitiesObj === null
          ? null
          : JSON.stringify(modalitiesObj);

    const limitObj = Object.prototype.hasOwnProperty.call(data, "limit")
      ? normalizeOptionalNullableObject(data["limit"])
      : undefined;
    if (Object.prototype.hasOwnProperty.call(data, "limit") && limitObj === undefined) {
      return c.json({ error: "invalid_request", message: "limit must be an object or null" }, 400);
    }
    const limitJson =
      limitObj === undefined
        ? (existing?.limit_json ?? null)
        : limitObj === null
          ? null
          : JSON.stringify(limitObj);

    const optionsObj = Object.prototype.hasOwnProperty.call(data, "options")
      ? normalizeOptionalNullableObject(data["options"])
      : safeJsonParse(existing?.options_json, {});
    if (optionsObj === undefined) {
      return c.json(
        { error: "invalid_request", message: "options must be an object or null" },
        400,
      );
    }

    const headersObj = Object.prototype.hasOwnProperty.call(data, "headers")
      ? normalizeOptionalNullableStringRecord(data["headers"])
      : (safeJsonParse(existing?.headers_json, {}) as Record<string, string>);
    if (headersObj === undefined) {
      return c.json(
        { error: "invalid_request", message: "headers must be an object or null" },
        400,
      );
    }

    const row = await deps.modelCatalog.overrides.upsertModelOverride({
      tenantId,
      providerId,
      modelId,
      enabled,
      name,
      family,
      releaseDate,
      lastUpdated,
      modalitiesJson,
      limitJson,
      providerNpm,
      providerApi,
      optionsJson: JSON.stringify(optionsObj ?? {}),
      headersJson: JSON.stringify(headersObj ?? {}),
    });

    return c.json(
      {
        override: {
          provider_id: row.provider_id,
          model_id: row.model_id,
          enabled: row.enabled,
          name: row.name,
          family: row.family,
          release_date: row.release_date,
          last_updated: row.last_updated,
          modalities: safeJsonParse(row.modalities_json, undefined),
          limit: safeJsonParse(row.limit_json, undefined),
          provider_npm: row.provider_npm,
          provider_api: row.provider_api,
          options: safeJsonParse(row.options_json, {}),
          headers: safeJsonParse(row.headers_json, {}),
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      },
      200,
    );
  });

  app.delete("/models/overrides/providers/:id/models/:model", async (c) => {
    const tenantId = requireTenantId(c);
    const providerId = c.req.param("id");
    const modelId = c.req.param("model");
    const deleted = await deps.modelCatalog.overrides.deleteModelOverride({
      tenantId,
      providerId,
      modelId,
    });
    return c.json({ deleted }, deleted ? 200 : 404);
  });

  return app;
}
