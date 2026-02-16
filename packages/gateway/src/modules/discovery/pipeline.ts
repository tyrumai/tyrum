/**
 * Discovery pipeline — simplified port of services/discovery/src/pipeline.rs
 *
 * Provides an in-memory connector cache and a pipeline skeleton.
 * The full Rust implementation includes Redis caching, HTTP probing, and
 * heuristic matching; this TypeScript version exposes the cache and pipeline
 * interfaces for use by the gateway service.
 */

import type {
  DiscoveryRequest,
  DiscoveryOutcome,
  DiscoveryStrategy,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Connector descriptor
// ---------------------------------------------------------------------------

export interface DiscoveryConnector {
  strategy: DiscoveryStrategy;
  locator: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: DiscoveryOutcome;
  expiresAt: number;
}

export class InMemoryConnectorCache {
  private cache = new Map<string, CacheEntry>();

  get(key: string): DiscoveryOutcome | undefined {
    const entry = this.cache.get(key);
    if (entry == null) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: DiscoveryOutcome, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class DiscoveryPipeline {
  constructor(private cache: InMemoryConnectorCache) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryOutcome> {
    const cacheKey = `discovery:${request.query}`;

    const cached = this.cache.get(cacheKey);
    if (cached != null) {
      return {
        ...cached,
        cached: true,
      };
    }

    // Without network access (Redis, HTTP probes) the pipeline returns an
    // empty resolution. The full implementation would iterate MCP, structured
    // API, and generic HTTP strategies.
    const outcome: DiscoveryOutcome = {
      resolutions: [],
      cached: false,
    };

    return outcome;
  }
}
