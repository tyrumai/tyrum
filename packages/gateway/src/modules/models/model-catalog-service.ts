import type { ModelsDevCatalog as ModelsDevCatalogT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";
import { coerceRecord, coerceStringRecord } from "../util/coerce.js";
import {
  CatalogOverrideDal,
  type CatalogModelOverrideRow,
  type CatalogProviderOverrideRow,
} from "./catalog-override-dal.js";
import type { ModelsDevLoadResult, ModelsDevService } from "./models-dev-service.js";

function normalizeOptionalString(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function parseJsonStringRecord(raw: string | null | undefined): Record<string, string> {
  const obj = parseJsonObject(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    const key = k.trim();
    const value = v.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function parseJsonLimitRecord(raw: string | null | undefined): Record<string, number> | undefined {
  const parsed = safeJsonParse<unknown>(raw, undefined);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseJsonModalities(raw: string | null | undefined): unknown | undefined {
  const parsed = safeJsonParse<unknown>(raw, undefined);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return parsed;
}

function mergeOverrideRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = {
    ...base,
    ...override,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeOverrideStringRecords(
  base: Record<string, string>,
  override: Record<string, string>,
): Record<string, string> | undefined {
  const merged = {
    ...base,
    ...override,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function groupModelOverrides(
  rows: CatalogModelOverrideRow[],
): Map<string, Map<string, CatalogModelOverrideRow>> {
  const byProvider = new Map<string, Map<string, CatalogModelOverrideRow>>();
  for (const row of rows) {
    const inner = byProvider.get(row.provider_id) ?? new Map<string, CatalogModelOverrideRow>();
    inner.set(row.model_id, row);
    byProvider.set(row.provider_id, inner);
  }
  return byProvider;
}

export class ModelCatalogService {
  readonly overrides: CatalogOverrideDal;

  constructor(
    private readonly opts: {
      db: SqlDb;
      modelsDev: ModelsDevService;
    },
  ) {
    this.overrides = new CatalogOverrideDal(opts.db);
  }

  async getEffectiveCatalog(input: { tenantId: string }): Promise<ModelsDevLoadResult> {
    const base = await this.opts.modelsDev.ensureLoaded();

    const [providerOverrides, modelOverrides] = await Promise.all([
      this.overrides.listProviderOverrides({ tenantId: input.tenantId }),
      this.overrides.listModelOverrides({ tenantId: input.tenantId }),
    ]);

    const providerOverrideById = new Map<string, CatalogProviderOverrideRow>(
      providerOverrides.map((row) => [row.provider_id, row]),
    );
    const modelOverridesByProvider = groupModelOverrides(modelOverrides);

    const providerIds = new Set<string>([
      ...Object.keys(base.catalog),
      ...providerOverrideById.keys(),
      ...modelOverridesByProvider.keys(),
    ]);

    const effectiveCatalog: Record<string, unknown> = {};

    const sortedProviderIds = Array.from(providerIds).toSorted((a, b) => a.localeCompare(b));
    for (const providerId of sortedProviderIds) {
      const baseProvider = base.catalog[providerId];
      const providerOverride = providerOverrideById.get(providerId);
      const providerEnabled = providerOverride ? providerOverride.enabled : true;

      const baseProviderOptions =
        coerceRecord((baseProvider as { options?: unknown } | undefined)?.options) ?? {};
      const overrideProviderOptions = providerOverride
        ? parseJsonObject(providerOverride.options_json)
        : {};
      const providerOptions = mergeOverrideRecords(baseProviderOptions, overrideProviderOptions);

      const baseProviderHeaders =
        coerceStringRecord((baseProvider as { headers?: unknown } | undefined)?.headers) ?? {};
      const overrideProviderHeaders = providerOverride
        ? parseJsonStringRecord(providerOverride.headers_json)
        : {};
      const providerHeaders = mergeOverrideStringRecords(
        baseProviderHeaders,
        overrideProviderHeaders,
      );

      const provider: Record<string, unknown> = baseProvider
        ? { ...(baseProvider as unknown as Record<string, unknown>) }
        : {
            id: providerId,
            name: providerId,
            env: [],
            models: {},
          };

      provider["id"] = providerId;
      provider["enabled"] = providerEnabled;

      const nameOverride = normalizeOptionalString(providerOverride?.name);
      if (nameOverride) {
        provider["name"] = nameOverride;
      } else if (!normalizeOptionalString(provider["name"] as string | undefined)) {
        provider["name"] = providerId;
      }

      if (providerOverride) {
        if (providerOverride.npm !== undefined) {
          const npmOverride = normalizeOptionalString(providerOverride.npm);
          if (npmOverride) provider["npm"] = npmOverride;
          else delete provider["npm"];
        }
        if (providerOverride.api !== undefined) {
          const apiOverride = normalizeOptionalString(providerOverride.api);
          if (apiOverride) provider["api"] = apiOverride;
          else delete provider["api"];
        }
        if (providerOverride.doc !== undefined) {
          const docOverride = normalizeOptionalString(providerOverride.doc);
          if (docOverride) provider["doc"] = docOverride;
          else delete provider["doc"];
        }
      }

      if (providerOptions) {
        provider["options"] = providerOptions;
      } else {
        delete provider["options"];
      }
      if (providerHeaders) {
        provider["headers"] = providerHeaders;
      } else {
        delete provider["headers"];
      }

      const baseModels =
        (baseProvider as { models?: Record<string, unknown> } | undefined)?.models ?? {};
      const overrideModels =
        modelOverridesByProvider.get(providerId) ?? new Map<string, CatalogModelOverrideRow>();
      const modelIds = new Set<string>([...Object.keys(baseModels), ...overrideModels.keys()]);

      const models: Record<string, unknown> = {};
      const sortedModelIds = Array.from(modelIds).toSorted((a, b) => a.localeCompare(b));
      for (const modelId of sortedModelIds) {
        const baseModel = baseModels[modelId] as Record<string, unknown> | undefined;
        const modelOverride = overrideModels.get(modelId);
        const modelEnabled = modelOverride ? modelOverride.enabled : true;

        const model: Record<string, unknown> = baseModel
          ? { ...baseModel }
          : {
              id: modelId,
              name: modelId,
            };

        model["id"] = modelId;
        model["enabled"] = modelEnabled;

        const modelNameOverride = normalizeOptionalString(modelOverride?.name);
        if (modelNameOverride) {
          model["name"] = modelNameOverride;
        } else if (!normalizeOptionalString(model["name"] as string | undefined)) {
          model["name"] = modelId;
        }

        const familyOverride = normalizeOptionalString(modelOverride?.family);
        if (familyOverride) {
          model["family"] = familyOverride;
        } else if (modelOverride?.family === null) {
          delete model["family"];
        }

        const releaseDateOverride = normalizeOptionalString(modelOverride?.release_date);
        if (releaseDateOverride) {
          model["release_date"] = releaseDateOverride;
        } else if (modelOverride?.release_date === null) {
          delete model["release_date"];
        }

        const lastUpdatedOverride = normalizeOptionalString(modelOverride?.last_updated);
        if (lastUpdatedOverride) {
          model["last_updated"] = lastUpdatedOverride;
        } else if (modelOverride?.last_updated === null) {
          delete model["last_updated"];
        }

        const modalitiesOverride = parseJsonModalities(modelOverride?.modalities_json);
        if (modalitiesOverride !== undefined) {
          model["modalities"] = modalitiesOverride;
        }

        const limitOverride = parseJsonLimitRecord(modelOverride?.limit_json);
        if (limitOverride !== undefined) {
          model["limit"] = limitOverride;
        }

        const baseModelProvider =
          coerceRecord((baseModel as { provider?: unknown } | undefined)?.provider) ?? {};
        const providerOverrideForModel: Record<string, unknown> = { ...baseModelProvider };
        const modelProviderNpmOverride = normalizeOptionalString(modelOverride?.provider_npm);
        const modelProviderApiOverride = normalizeOptionalString(modelOverride?.provider_api);
        if (modelProviderNpmOverride) {
          providerOverrideForModel["npm"] = modelProviderNpmOverride;
        } else if (modelOverride?.provider_npm === null) {
          delete providerOverrideForModel["npm"];
        }
        if (modelProviderApiOverride) {
          providerOverrideForModel["api"] = modelProviderApiOverride;
        } else if (modelOverride?.provider_api === null) {
          delete providerOverrideForModel["api"];
        }
        if (Object.keys(providerOverrideForModel).length > 0) {
          model["provider"] = providerOverrideForModel;
        } else {
          delete model["provider"];
        }

        const baseModelOptions =
          coerceRecord((baseModel as { options?: unknown } | undefined)?.options) ?? {};
        const overrideModelOptions = modelOverride
          ? parseJsonObject(modelOverride.options_json)
          : {};
        const mergedModelOptions = mergeOverrideRecords(baseModelOptions, overrideModelOptions);
        if (mergedModelOptions) {
          model["options"] = mergedModelOptions;
        } else {
          delete model["options"];
        }

        const baseModelHeaders =
          coerceStringRecord((baseModel as { headers?: unknown } | undefined)?.headers) ?? {};
        const overrideModelHeaders = modelOverride
          ? parseJsonStringRecord(modelOverride.headers_json)
          : {};
        const mergedModelHeaders = mergeOverrideStringRecords(
          baseModelHeaders,
          overrideModelHeaders,
        );
        if (mergedModelHeaders) {
          model["headers"] = mergedModelHeaders;
        } else {
          delete model["headers"];
        }

        models[modelId] = model;
      }

      provider["models"] = models;
      effectiveCatalog[providerId] = provider;
    }

    return {
      catalog: effectiveCatalog as ModelsDevCatalogT,
      status: base.status,
    };
  }
}
