import { describe, expect, it } from "vitest";
import {
  DiscoveryPipeline,
  InMemoryConnectorCache,
} from "../../src/modules/discovery/pipeline.js";
import type { CapabilityMemoryRow } from "../../src/modules/memory/dal.js";
import type { DiscoveryRequest } from "@tyrum/schemas";

function makeRow(overrides: Partial<CapabilityMemoryRow> = {}): CapabilityMemoryRow {
  return {
    id: 1,
    capability_type: "web_scrape",
    capability_identifier: "example.com",
    executor_kind: "playwright",
    selectors: null,
    outcome_metadata: null,
    cost_profile: null,
    anti_bot_notes: null,
    result_summary: "Scraped successfully",
    success_count: 3,
    last_success_at: new Date().toISOString(),
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return {
    query: "scrape",
    max_results: 5,
    ...overrides,
  };
}

describe("DiscoveryPipeline", () => {
  it("returns empty resolutions with no strategies", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache());
    const outcome = await pipeline.discover(makeRequest());
    expect(outcome.resolutions).toHaveLength(0);
    expect(outcome.cached).toBe(false);
  });

  it("returns resolutions from capability memory strategy", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: {
        getCapabilityMemories: () => [makeRow()],
      },
    });

    const outcome = await pipeline.discover(makeRequest({ query: "web_scrape" }));
    expect(outcome.resolutions.length).toBeGreaterThanOrEqual(1);
    expect(outcome.resolutions[0].connector_url).toBe("https://example.com");
    expect(outcome.cached).toBe(false);
  });

  it("returns resolutions from MCP tool strategy", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      mcpToolSource: {
        listTools: () => [
          { id: "mcp.github.search", description: "Search GitHub", keywords: ["github", "search"] },
        ],
      },
    });

    const outcome = await pipeline.discover(makeRequest({ query: "github" }));
    expect(outcome.resolutions.length).toBeGreaterThanOrEqual(1);
    expect(outcome.resolutions[0].strategy).toBe("mcp");
  });

  it("merges results from both strategies", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: {
        getCapabilityMemories: () => [makeRow()],
      },
      mcpToolSource: {
        listTools: () => [
          { id: "mcp.web.scrape", description: "Scrape web pages", keywords: ["scrape", "web"] },
        ],
      },
    });

    const outcome = await pipeline.discover(makeRequest({ query: "scrape" }));
    expect(outcome.resolutions.length).toBeGreaterThanOrEqual(2);

    const strategies = outcome.resolutions.map((r) => r.strategy);
    expect(strategies).toContain("structured_api");
    expect(strategies).toContain("mcp");
  });

  it("caches results on cache hit", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: {
        getCapabilityMemories: () => [makeRow()],
      },
    });

    const first = await pipeline.discover(makeRequest({ query: "web_scrape" }));
    expect(first.cached).toBe(false);

    const second = await pipeline.discover(makeRequest({ query: "web_scrape" }));
    expect(second.cached).toBe(true);
    expect(second.resolutions).toEqual(first.resolutions);
  });

  it("does not cache empty results", async () => {
    let callCount = 0;
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: {
        getCapabilityMemories: () => {
          callCount++;
          return [];
        },
      },
    });

    await pipeline.discover(makeRequest({ query: "nothing" }));
    await pipeline.discover(makeRequest({ query: "nothing" }));
    // Should have called the source twice (not cached)
    expect(callCount).toBe(2);
  });

  it("respects max_results across merged strategies", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: i, capability_identifier: `site${i}.com` }),
    );
    const tools = Array.from({ length: 5 }, (_, i) => ({
      id: `mcp.s.tool${i}`,
      description: `Scrape tool ${i}`,
      keywords: ["scrape"],
    }));

    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: { getCapabilityMemories: () => rows },
      mcpToolSource: { listTools: () => tools },
    });

    const outcome = await pipeline.discover(makeRequest({ query: "scrape", max_results: 3 }));
    expect(outcome.resolutions).toHaveLength(3);
  });

  it("assigns sequential ranks after merge", async () => {
    const pipeline = new DiscoveryPipeline(new InMemoryConnectorCache(), {
      capabilityMemorySource: {
        getCapabilityMemories: () => [makeRow()],
      },
      mcpToolSource: {
        listTools: () => [
          { id: "mcp.web.scrape", description: "Scrape web", keywords: ["scrape"] },
        ],
      },
    });

    const outcome = await pipeline.discover(makeRequest({ query: "scrape" }));
    const ranks = outcome.resolutions.map((r) => r.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i));
  });
});
