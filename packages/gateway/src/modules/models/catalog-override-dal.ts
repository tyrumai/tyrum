import type { SqlDb } from "../../statestore/types.js";

export interface CatalogProviderOverrideRow {
  tenant_id: string;
  provider_id: string;
  enabled: boolean;
  name: string | null;
  npm: string | null;
  api: string | null;
  doc: string | null;
  options_json: string;
  headers_json: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogModelOverrideRow {
  tenant_id: string;
  provider_id: string;
  model_id: string;
  enabled: boolean;
  name: string | null;
  family: string | null;
  release_date: string | null;
  last_updated: string | null;
  modalities_json: string | null;
  limit_json: string | null;
  provider_npm: string | null;
  provider_api: string | null;
  options_json: string;
  headers_json: string;
  created_at: string;
  updated_at: string;
}

interface RawCatalogProviderOverrideRow {
  tenant_id: string;
  provider_id: string;
  enabled: number | boolean;
  name: string | null;
  npm: string | null;
  api: string | null;
  doc: string | null;
  options_json: string;
  headers_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawCatalogModelOverrideRow {
  tenant_id: string;
  provider_id: string;
  model_id: string;
  enabled: number | boolean;
  name: string | null;
  family: string | null;
  release_date: string | null;
  last_updated: string | null;
  modalities_json: string | null;
  limit_json: string | null;
  provider_npm: string | null;
  provider_api: string | null;
  options_json: string;
  headers_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeBool(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toProviderRow(raw: RawCatalogProviderOverrideRow): CatalogProviderOverrideRow {
  return {
    tenant_id: raw.tenant_id,
    provider_id: raw.provider_id,
    enabled: normalizeBool(raw.enabled),
    name: raw.name,
    npm: raw.npm,
    api: raw.api,
    doc: raw.doc,
    options_json: raw.options_json,
    headers_json: raw.headers_json,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

function toModelRow(raw: RawCatalogModelOverrideRow): CatalogModelOverrideRow {
  return {
    tenant_id: raw.tenant_id,
    provider_id: raw.provider_id,
    model_id: raw.model_id,
    enabled: normalizeBool(raw.enabled),
    name: raw.name,
    family: raw.family,
    release_date: raw.release_date,
    last_updated: raw.last_updated,
    modalities_json: raw.modalities_json,
    limit_json: raw.limit_json,
    provider_npm: raw.provider_npm,
    provider_api: raw.provider_api,
    options_json: raw.options_json,
    headers_json: raw.headers_json,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class CatalogOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async listProviderOverrides(input: { tenantId: string }): Promise<CatalogProviderOverrideRow[]> {
    const rows = await this.db.all<RawCatalogProviderOverrideRow>(
      `SELECT tenant_id, provider_id, enabled, name, npm, api, doc, options_json, headers_json, created_at, updated_at
       FROM catalog_provider_overrides
       WHERE tenant_id = ?
       ORDER BY provider_id ASC`,
      [input.tenantId],
    );
    return rows.map(toProviderRow);
  }

  async getProviderOverride(input: {
    tenantId: string;
    providerId: string;
  }): Promise<CatalogProviderOverrideRow | undefined> {
    const row = await this.db.get<RawCatalogProviderOverrideRow>(
      `SELECT tenant_id, provider_id, enabled, name, npm, api, doc, options_json, headers_json, created_at, updated_at
       FROM catalog_provider_overrides
       WHERE tenant_id = ? AND provider_id = ?
       LIMIT 1`,
      [input.tenantId, input.providerId],
    );
    return row ? toProviderRow(row) : undefined;
  }

  async upsertProviderOverride(input: {
    tenantId: string;
    providerId: string;
    enabled: boolean;
    name?: string | null;
    npm?: string | null;
    api?: string | null;
    doc?: string | null;
    optionsJson: string;
    headersJson: string;
  }): Promise<CatalogProviderOverrideRow> {
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO catalog_provider_overrides (
         tenant_id,
         provider_id,
         enabled,
         name,
         npm,
         api,
         doc,
         options_json,
         headers_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, provider_id) DO UPDATE SET
         enabled = excluded.enabled,
         name = excluded.name,
         npm = excluded.npm,
         api = excluded.api,
         doc = excluded.doc,
         options_json = excluded.options_json,
         headers_json = excluded.headers_json,
         updated_at = excluded.updated_at`,
      [
        input.tenantId,
        input.providerId,
        input.enabled ? 1 : 0,
        input.name ?? null,
        input.npm ?? null,
        input.api ?? null,
        input.doc ?? null,
        input.optionsJson,
        input.headersJson,
        nowIso,
        nowIso,
      ],
    );

    const row = await this.getProviderOverride({
      tenantId: input.tenantId,
      providerId: input.providerId,
    });
    if (!row) {
      throw new Error("catalog provider override upsert failed");
    }
    return row;
  }

  async deleteProviderOverride(input: { tenantId: string; providerId: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM catalog_provider_overrides
       WHERE tenant_id = ? AND provider_id = ?`,
      [input.tenantId, input.providerId],
    );
    return res.changes === 1;
  }

  async listModelOverrides(input: {
    tenantId: string;
    providerId?: string;
  }): Promise<CatalogModelOverrideRow[]> {
    const providerId = input.providerId?.trim();
    const rows = await (providerId
      ? this.db.all<RawCatalogModelOverrideRow>(
          `SELECT tenant_id, provider_id, model_id, enabled, name, family, release_date, last_updated,
                  modalities_json, limit_json, provider_npm, provider_api, options_json, headers_json, created_at, updated_at
           FROM catalog_model_overrides
           WHERE tenant_id = ? AND provider_id = ?
           ORDER BY model_id ASC`,
          [input.tenantId, providerId],
        )
      : this.db.all<RawCatalogModelOverrideRow>(
          `SELECT tenant_id, provider_id, model_id, enabled, name, family, release_date, last_updated,
                  modalities_json, limit_json, provider_npm, provider_api, options_json, headers_json, created_at, updated_at
           FROM catalog_model_overrides
           WHERE tenant_id = ?
           ORDER BY provider_id ASC, model_id ASC`,
          [input.tenantId],
        ));

    return rows.map(toModelRow);
  }

  async getModelOverride(input: {
    tenantId: string;
    providerId: string;
    modelId: string;
  }): Promise<CatalogModelOverrideRow | undefined> {
    const row = await this.db.get<RawCatalogModelOverrideRow>(
      `SELECT tenant_id, provider_id, model_id, enabled, name, family, release_date, last_updated,
              modalities_json, limit_json, provider_npm, provider_api, options_json, headers_json, created_at, updated_at
       FROM catalog_model_overrides
       WHERE tenant_id = ? AND provider_id = ? AND model_id = ?
       LIMIT 1`,
      [input.tenantId, input.providerId, input.modelId],
    );
    return row ? toModelRow(row) : undefined;
  }

  async upsertModelOverride(input: {
    tenantId: string;
    providerId: string;
    modelId: string;
    enabled: boolean;
    name?: string | null;
    family?: string | null;
    releaseDate?: string | null;
    lastUpdated?: string | null;
    modalitiesJson?: string | null;
    limitJson?: string | null;
    providerNpm?: string | null;
    providerApi?: string | null;
    optionsJson: string;
    headersJson: string;
  }): Promise<CatalogModelOverrideRow> {
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO catalog_model_overrides (
         tenant_id,
         provider_id,
         model_id,
         enabled,
         name,
         family,
         release_date,
         last_updated,
         modalities_json,
         limit_json,
         provider_npm,
         provider_api,
         options_json,
         headers_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, provider_id, model_id) DO UPDATE SET
         enabled = excluded.enabled,
         name = excluded.name,
         family = excluded.family,
         release_date = excluded.release_date,
         last_updated = excluded.last_updated,
         modalities_json = excluded.modalities_json,
         limit_json = excluded.limit_json,
         provider_npm = excluded.provider_npm,
         provider_api = excluded.provider_api,
         options_json = excluded.options_json,
         headers_json = excluded.headers_json,
         updated_at = excluded.updated_at`,
      [
        input.tenantId,
        input.providerId,
        input.modelId,
        input.enabled ? 1 : 0,
        input.name ?? null,
        input.family ?? null,
        input.releaseDate ?? null,
        input.lastUpdated ?? null,
        input.modalitiesJson ?? null,
        input.limitJson ?? null,
        input.providerNpm ?? null,
        input.providerApi ?? null,
        input.optionsJson,
        input.headersJson,
        nowIso,
        nowIso,
      ],
    );

    const row = await this.getModelOverride({
      tenantId: input.tenantId,
      providerId: input.providerId,
      modelId: input.modelId,
    });
    if (!row) {
      throw new Error("catalog model override upsert failed");
    }
    return row;
  }

  async deleteModelOverride(input: {
    tenantId: string;
    providerId: string;
    modelId: string;
  }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM catalog_model_overrides
       WHERE tenant_id = ? AND provider_id = ? AND model_id = ?`,
      [input.tenantId, input.providerId, input.modelId],
    );
    return res.changes === 1;
  }
}
