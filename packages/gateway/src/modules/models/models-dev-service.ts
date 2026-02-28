import { createHash, randomUUID } from "node:crypto";
import { ModelsDevCatalog } from "@tyrum/schemas";
import type { ModelsDevCatalog as ModelsDevCatalogT } from "@tyrum/schemas";
import type { Logger } from "../observability/logger.js";
import type { ModelsDevCacheSource } from "./models-dev-cache-dal.js";
import { ModelsDevCacheDal } from "./models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "./models-dev-refresh-lease-dal.js";
import { snapshot as bundledSnapshot } from "./models-dev-snapshot.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_LEASE_KEY = "models.dev";
const REFRESH_LEASE_TTL_MS = 60_000;

function resolveModelsDevUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "https://models.dev";
}

function resolveRefreshIntervalMs(value: number | undefined): number {
  if (value === undefined || value <= 0) return DEFAULT_REFRESH_INTERVAL_MS;
  return Math.max(10_000, value);
}

function resolveTimeoutMs(value: number | undefined): number {
  if (value === undefined || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, value);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface ModelsDevStatus {
  source: ModelsDevCacheSource;
  fetched_at: string | null;
  updated_at: string;
  etag: string | null;
  sha256: string;
  provider_count: number;
  model_count: number;
  last_error: string | null;
}

export interface ModelsDevLoadResult {
  catalog: ModelsDevCatalogT;
  status: ModelsDevStatus;
}

export class ModelsDevService {
  private current: ModelsDevLoadResult | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly instanceOwner: string;
  private readonly url: string;
  private readonly disableFetch: boolean;
  private readonly refreshIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly opts: {
      cacheDal: ModelsDevCacheDal;
      leaseDal: ModelsDevRefreshLeaseDal;
      logger?: Logger;
      fetchImpl?: typeof fetch;
      modelsDev?: {
        url?: string;
        timeoutMs?: number;
        refreshIntervalMs?: number;
        disableFetch?: boolean;
      };
      instanceOwner?: string;
    },
  ) {
    this.instanceOwner = opts.instanceOwner?.trim() || `instance-${randomUUID()}`;
    this.url = resolveModelsDevUrl(opts.modelsDev?.url).replace(/\/$/, "");
    this.disableFetch = opts.modelsDev?.disableFetch ?? false;
    this.refreshIntervalMs = resolveRefreshIntervalMs(opts.modelsDev?.refreshIntervalMs);
    this.timeoutMs = resolveTimeoutMs(opts.modelsDev?.timeoutMs);
  }

  private buildStatus(input: {
    source: ModelsDevCacheSource;
    fetchedAt: string | null;
    updatedAt: string;
    etag: string | null;
    sha256: string;
    lastError: string | null;
    catalog: ModelsDevCatalogT;
  }): ModelsDevStatus {
    const providers = Object.keys(input.catalog);
    const modelCount = Object.values(input.catalog).reduce((acc, provider) => {
      return acc + Object.keys(provider.models ?? {}).length;
    }, 0);

    return {
      source: input.source,
      fetched_at: input.fetchedAt,
      updated_at: input.updatedAt,
      etag: input.etag,
      sha256: input.sha256,
      provider_count: providers.length,
      model_count: modelCount,
      last_error: input.lastError,
    };
  }

  private parseCatalog(raw: unknown): ModelsDevCatalogT {
    return ModelsDevCatalog.parse(raw);
  }

  private async recordError(input: {
    error: string;
    nowIso: string;
  }): Promise<ModelsDevLoadResult> {
    const cached = await this.opts.cacheDal.get();

    if (!cached) {
      const json = JSON.stringify(bundledSnapshot);
      const sha256 = sha256Hex(json);
      const row = await this.opts.cacheDal.upsert({
        fetchedAt: null,
        etag: null,
        sha256,
        json,
        source: "bundled",
        lastError: input.error,
        nowIso: input.nowIso,
      });

      const catalog = this.parseCatalog(JSON.parse(row.json) as unknown);
      const result: ModelsDevLoadResult = {
        catalog,
        status: this.buildStatus({
          source: row.source,
          fetchedAt: row.fetched_at,
          updatedAt: row.updated_at,
          etag: row.etag,
          sha256: row.sha256,
          lastError: row.last_error,
          catalog,
        }),
      };
      this.current = result;
      return result;
    }

    await this.opts.cacheDal.setError({ error: input.error, nowIso: input.nowIso });

    if (this.current) {
      const result: ModelsDevLoadResult = {
        catalog: this.current.catalog,
        status: {
          ...this.current.status,
          last_error: input.error,
          updated_at: input.nowIso,
        },
      };
      this.current = result;
      return result;
    }

    try {
      const catalog = this.parseCatalog(JSON.parse(cached.json) as unknown);
      const result: ModelsDevLoadResult = {
        catalog,
        status: this.buildStatus({
          source: cached.source,
          fetchedAt: cached.fetched_at,
          updatedAt: input.nowIso,
          etag: cached.etag,
          sha256: cached.sha256,
          lastError: input.error,
          catalog,
        }),
      };
      this.current = result;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("models_dev.cache_parse_failed", { error: message });

      const json = JSON.stringify(bundledSnapshot);
      const sha256 = sha256Hex(json);
      const row = await this.opts.cacheDal.upsert({
        fetchedAt: null,
        etag: null,
        sha256,
        json,
        source: "bundled",
        lastError: input.error,
        nowIso: input.nowIso,
      });

      const catalog = this.parseCatalog(bundledSnapshot);
      const result: ModelsDevLoadResult = {
        catalog,
        status: this.buildStatus({
          source: row.source,
          fetchedAt: row.fetched_at,
          updatedAt: row.updated_at,
          etag: row.etag,
          sha256: row.sha256,
          lastError: row.last_error,
          catalog,
        }),
      };
      this.current = result;
      return result;
    }
  }

  async ensureLoaded(): Promise<ModelsDevLoadResult> {
    const cached = await this.opts.cacheDal.get();
    if (cached) {
      if (
        this.current &&
        cached.updated_at === this.current.status.updated_at &&
        cached.sha256 === this.current.status.sha256
      ) {
        return this.current;
      }

      // Avoid re-parsing JSON unless content changed; still sync status fields (e.g., last_error).
      if (this.current && cached.sha256 === this.current.status.sha256) {
        const catalog = this.current.catalog;
        const result: ModelsDevLoadResult = {
          catalog,
          status: this.buildStatus({
            source: cached.source,
            fetchedAt: cached.fetched_at,
            updatedAt: cached.updated_at,
            etag: cached.etag,
            sha256: cached.sha256,
            lastError: cached.last_error,
            catalog,
          }),
        };
        this.current = result;
        return result;
      }

      try {
        const catalog = this.parseCatalog(JSON.parse(cached.json) as unknown);
        const result: ModelsDevLoadResult = {
          catalog,
          status: this.buildStatus({
            source: cached.source,
            fetchedAt: cached.fetched_at,
            updatedAt: cached.updated_at,
            etag: cached.etag,
            sha256: cached.sha256,
            lastError: cached.last_error,
            catalog,
          }),
        };
        this.current = result;
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.logger?.warn("models_dev.cache_parse_failed", { error: message });
        const nowIso = new Date().toISOString();
        return await this.recordError({
          error: `models.dev cache parse failed: ${message}`,
          nowIso,
        });
      }
    }

    if (this.current) return this.current;

    // No cached row: materialize bundled snapshot into cache.
    const nowIso = new Date().toISOString();
    const json = JSON.stringify(bundledSnapshot);
    const sha256 = sha256Hex(json);
    const row = await this.opts.cacheDal.upsert({
      fetchedAt: null,
      etag: null,
      sha256,
      json,
      source: "bundled",
      lastError: null,
      nowIso,
    });

    const catalog = this.parseCatalog(JSON.parse(row.json) as unknown);
    const result: ModelsDevLoadResult = {
      catalog,
      status: this.buildStatus({
        source: "bundled",
        fetchedAt: row.fetched_at,
        updatedAt: row.updated_at,
        etag: row.etag,
        sha256: row.sha256,
        lastError: row.last_error,
        catalog,
      }),
    };
    this.current = result;
    return result;
  }

  async refreshNow(): Promise<ModelsDevLoadResult> {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const owner = this.instanceOwner;

    if (this.disableFetch) {
      return await this.ensureLoaded();
    }

    const acquired = await this.opts.leaseDal.tryAcquire({
      key: REFRESH_LEASE_KEY,
      owner,
      nowMs,
      leaseTtlMs: REFRESH_LEASE_TTL_MS,
    });
    if (!acquired) {
      return await this.ensureLoaded();
    }

    try {
      const url = this.url;
      const timeoutMs = this.timeoutMs;
      const cached = await this.opts.cacheDal.get();

      const headers: Record<string, string> = {};
      if (cached?.etag) headers["if-none-match"] = cached.etag;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await (this.opts.fetchImpl ?? fetch)(`${url}/api.json`, {
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.status === 304 && cached) {
        const catalog = this.parseCatalog(JSON.parse(cached.json) as unknown);
        const result: ModelsDevLoadResult = {
          catalog,
          status: this.buildStatus({
            source: "cache",
            fetchedAt: nowIso,
            updatedAt: nowIso,
            etag: cached.etag,
            sha256: cached.sha256,
            lastError: null,
            catalog,
          }),
        };

        await this.opts.cacheDal.upsert({
          fetchedAt: nowIso,
          etag: cached.etag,
          sha256: cached.sha256,
          json: cached.json,
          source: "cache",
          lastError: null,
          nowIso,
        });
        this.current = result;
        return result;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const message = `models.dev fetch failed (${String(res.status)}): ${body.slice(0, 400)}`;
        this.opts.logger?.warn("models_dev.refresh_failed", { status: res.status });
        return await this.recordError({ error: message, nowIso });
      }

      const text = await res.text();
      const parsed = JSON.parse(text) as unknown;
      const catalog = this.parseCatalog(parsed);

      const etag = res.headers.get("etag");
      const sha256 = sha256Hex(text);
      const row = await this.opts.cacheDal.upsert({
        fetchedAt: nowIso,
        etag: etag ?? null,
        sha256,
        json: text,
        source: "remote",
        lastError: null,
        nowIso,
      });

      const result: ModelsDevLoadResult = {
        catalog,
        status: this.buildStatus({
          source: "remote",
          fetchedAt: row.fetched_at,
          updatedAt: row.updated_at,
          etag: row.etag,
          sha256: row.sha256,
          lastError: row.last_error,
          catalog,
        }),
      };

      this.current = result;
      this.opts.logger?.info("models_dev.refreshed", {
        provider_count: result.status.provider_count,
        model_count: result.status.model_count,
        source: result.status.source,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("models_dev.refresh_failed", { error: message });
      return await this.recordError({ error: message, nowIso });
    } finally {
      await this.opts.leaseDal.release({ key: REFRESH_LEASE_KEY, owner }).catch(() => {});
    }
  }

  startBackgroundRefresh(): void {
    if (this.refreshTimer) return;
    const intervalMs = this.refreshIntervalMs;

    // Fire and forget: initial refresh attempts remote first, else cached/bundled.
    void this.refreshNow().catch(() => {});

    this.refreshTimer = setInterval(() => {
      void this.refreshNow().catch(() => {});
    }, intervalMs).unref();
  }

  stopBackgroundRefresh(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }
}
