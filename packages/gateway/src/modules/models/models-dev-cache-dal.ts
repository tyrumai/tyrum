import type { SqlDb } from "../../statestore/types.js";

export type ModelsDevCacheSource = "remote" | "cache" | "bundled";

export interface ModelsDevCacheRow {
  id: 1;
  fetched_at: string | null;
  etag: string | null;
  sha256: string;
  json: string;
  source: ModelsDevCacheSource;
  last_error: string | null;
  updated_at: string;
}

interface RawModelsDevCacheRow {
  id: number;
  fetched_at: string | Date | null;
  etag: string | null;
  sha256: string;
  json: string;
  source: string;
  last_error: string | null;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawModelsDevCacheRow): ModelsDevCacheRow {
  return {
    id: 1,
    fetched_at: normalizeTime(raw.fetched_at),
    etag: raw.etag ?? null,
    sha256: raw.sha256,
    json: raw.json,
    source: raw.source === "bundled" ? "bundled" : raw.source === "remote" ? "remote" : "cache",
    last_error: raw.last_error ?? null,
    updated_at: normalizeTime(raw.updated_at) ?? new Date().toISOString(),
  };
}

export class ModelsDevCacheDal {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<ModelsDevCacheRow | undefined> {
    const row = await this.db.get<RawModelsDevCacheRow>(
      "SELECT * FROM models_dev_cache WHERE id = 1",
      [],
    );
    return row ? toRow(row) : undefined;
  }

  async upsert(input: {
    fetchedAt: string | null;
    etag: string | null;
    sha256: string;
    json: string;
    source: ModelsDevCacheSource;
    lastError: string | null;
    nowIso: string;
  }): Promise<ModelsDevCacheRow> {
    await this.db.run(
      `INSERT INTO models_dev_cache (id, fetched_at, etag, sha256, json, source, last_error, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         etag = excluded.etag,
         sha256 = excluded.sha256,
         json = excluded.json,
         source = excluded.source,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        input.fetchedAt,
        input.etag,
        input.sha256,
        input.json,
        input.source,
        input.lastError,
        input.nowIso,
      ],
    );

    const row = await this.get();
    if (!row) throw new Error("models_dev_cache upsert failed");
    return row;
  }

  async setError(input: { error: string; nowIso: string }): Promise<void> {
    await this.db.run(
      `UPDATE models_dev_cache
       SET last_error = ?,
           updated_at = ?
       WHERE id = 1`,
      [input.error, input.nowIso],
    );
  }
}
