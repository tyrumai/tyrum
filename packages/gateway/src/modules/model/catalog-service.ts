import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogModel as CatalogModelT, CatalogProvider as CatalogProviderT } from "@tyrum/schemas";
import { CatalogProvider } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour
const MODELS_DEV_URL = "https://models.dev/api.json";

/** Provider ID → env var(s) that indicate credentials are available. */
const PROVIDER_ENV_MAP: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  azure: ["AZURE_OPENAI_API_KEY"],
  "amazon-bedrock": ["AWS_ACCESS_KEY_ID"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  xai: ["XAI_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  "fireworks-ai": ["FIREWORKS_API_KEY"],
  "together-ai": ["TOGETHER_AI_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
};

export interface CatalogServiceOpts {
  cacheDir: string;
  refreshIntervalMs?: number;
}

export class ModelCatalogService {
  private providers = new Map<string, CatalogProviderT>();
  private models = new Map<string, { model: CatalogModelT; providerId: string }>();
  private lastRefresh = 0;
  private readonly cacheFile: string;
  private readonly refreshInterval: number;

  constructor(private readonly opts: CatalogServiceOpts) {
    this.cacheFile = join(opts.cacheDir, "models.json");
    this.refreshInterval = opts.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
  }

  /** Get a model by its ID. Call refresh() first if data is stale. */
  getModel(modelId: string): (CatalogModelT & { provider_id: string }) | undefined {
    const entry = this.models.get(modelId);
    if (!entry) return undefined;
    return { ...entry.model, provider_id: entry.providerId };
  }

  /** Get a provider by its ID. */
  getProvider(providerId: string): CatalogProviderT | undefined {
    return this.providers.get(providerId);
  }

  /** List all loaded providers. */
  listProviders(): CatalogProviderT[] {
    return Array.from(this.providers.values());
  }

  /** List providers whose env vars are set (credentials available). */
  getEnabledProviders(): CatalogProviderT[] {
    return this.listProviders().filter((p) => {
      const envVars = p.env.length > 0 ? p.env : (PROVIDER_ENV_MAP[p.id] ?? []);
      return envVars.some((key) => !!process.env[key]?.trim());
    });
  }

  /** True if data has been loaded and is not stale. */
  get isLoaded(): boolean {
    return this.providers.size > 0;
  }

  /** True if the cache is stale and should be refreshed. */
  get isStale(): boolean {
    return Date.now() - this.lastRefresh > this.refreshInterval;
  }

  /**
   * Three-tier loading cascade:
   * 1. Disk cache (if fresh)
   * 2. Network fetch from models.dev
   * 3. Bundled snapshot fallback
   */
  async refresh(): Promise<void> {
    // Tier 1: disk cache
    const cached = this.readCache();
    if (cached) {
      this.ingestRaw(cached);
      return;
    }

    // Tier 2: network fetch
    try {
      const resp = await fetch(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const raw = (await resp.json()) as Record<string, unknown>;
        this.writeCache(raw);
        this.ingestRaw(raw);
        return;
      }
    } catch {
      // network failure — fall through to snapshot
    }

    // Tier 3: bundled snapshot
    this.loadSnapshot();
  }

  /** Load only from bundled snapshot (for offline / test use). */
  loadSnapshot(): void {
    try {
      const snapshotPath = join(__dirname, "models-snapshot.json");
      const raw = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Record<string, unknown>;
      this.ingestRaw(raw);
    } catch {
      // No snapshot available — service will have empty catalog
    }
  }

  private readCache(): Record<string, unknown> | undefined {
    try {
      const stat = statSync(this.cacheFile);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > this.refreshInterval) return undefined;
      const raw = JSON.parse(readFileSync(this.cacheFile, "utf-8")) as Record<string, unknown>;
      return raw;
    } catch {
      return undefined;
    }
  }

  private writeCache(raw: Record<string, unknown>): void {
    try {
      mkdirSync(this.opts.cacheDir, { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify(raw));
    } catch {
      // cache write failure is non-fatal
    }
  }

  private ingestRaw(raw: Record<string, unknown>): void {
    this.providers.clear();
    this.models.clear();

    for (const [id, providerRaw] of Object.entries(raw)) {
      if (!providerRaw || typeof providerRaw !== "object") continue;
      const parsed = CatalogProvider.safeParse(providerRaw);
      if (!parsed.success) continue;

      const provider = parsed.data;
      this.providers.set(id, provider);

      for (const [modelId, model] of Object.entries(provider.models)) {
        this.models.set(modelId, { model, providerId: id });
      }
    }

    this.lastRefresh = Date.now();
  }
}
