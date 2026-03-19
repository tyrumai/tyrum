/**
 * Discovery pipeline.
 *
 * Runs pluggable resolution strategies (capability memory, MCP tools) and
 * caches results in an in-memory connector cache.
 */

import type {
  DiscoveryRequest,
  DiscoveryOutcome,
  DiscoveryResolution,
  DiscoveryStrategy,
} from "@tyrum/contracts";
import type { CapabilityMemorySource } from "./strategies/capability-memory.js";
import type { McpToolSource } from "./strategies/mcp-tools.js";
import { resolveFromCapabilityMemory } from "./strategies/capability-memory.js";
import { resolveFromMcpTools } from "./strategies/mcp-tools.js";

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
// Pipeline configuration
// ---------------------------------------------------------------------------

export interface DiscoveryPipelineDeps {
  capabilityMemorySource?: CapabilityMemorySource;
  mcpToolSource?: McpToolSource;
}

/** Default cache TTL: 60 seconds. */
const CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class DiscoveryPipeline {
  constructor(
    private cache: InMemoryConnectorCache,
    private deps: DiscoveryPipelineDeps = {},
  ) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryOutcome> {
    const cacheKey = `discovery:${request.query}`;

    const cached = this.cache.get(cacheKey);
    if (cached != null) {
      return {
        ...cached,
        cached: true,
      };
    }

    const resolutions: DiscoveryResolution[] = [];

    // Strategy 1: Capability memory (structured API connectors from past successes)
    if (this.deps.capabilityMemorySource) {
      const capResults = await resolveFromCapabilityMemory(
        request,
        this.deps.capabilityMemorySource,
      );
      resolutions.push(...capResults);
    }

    // Strategy 2: MCP tool descriptors (fuzzy match against available tools)
    if (this.deps.mcpToolSource) {
      const mcpResults = resolveFromMcpTools(request, this.deps.mcpToolSource);
      resolutions.push(...mcpResults);
    }

    // Merge and re-rank by original rank, then truncate to max_results
    resolutions.sort((a, b) => a.rank - b.rank);
    const limit = request.max_results ?? 5;
    const trimmed = resolutions.slice(0, limit);

    // Re-assign ranks after merge
    for (let i = 0; i < trimmed.length; i++) {
      trimmed[i]!.rank = i;
    }

    const outcome: DiscoveryOutcome = {
      resolutions: trimmed,
      cached: false,
    };

    if (trimmed.length > 0) {
      this.cache.set(cacheKey, outcome, CACHE_TTL_MS);
    }

    return outcome;
  }
}
