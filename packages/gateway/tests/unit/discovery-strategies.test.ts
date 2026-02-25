import { describe, expect, it } from "vitest";
import {
  resolveFromCapabilityMemory,
  type CapabilityMemorySource,
} from "../../src/modules/discovery/strategies/capability-memory.js";
import {
  resolveFromMcpTools,
  type McpToolSource,
} from "../../src/modules/discovery/strategies/mcp-tools.js";
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
    result_summary: "Scraped title from homepage",
    success_count: 5,
    last_success_at: new Date().toISOString(),
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSource(rows: CapabilityMemoryRow[]): CapabilityMemorySource {
  return {
    async getCapabilityMemories() {
      return rows;
    },
  };
}

function makeRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return {
    query: "web_scrape",
    max_results: 5,
    ...overrides,
  };
}

describe("CapabilityMemoryStrategy", () => {
  it("returns matching capability memories", async () => {
    const source = makeSource([makeRow()]);
    const results = await resolveFromCapabilityMemory(makeRequest(), source);

    expect(results).toHaveLength(1);
    expect(results[0].strategy).toBe("structured_api");
    expect(results[0].connector_url).toBe("https://example.com");
    expect(results[0].rank).toBe(0);
    expect(results[0].label).toBe("web_scrape:playwright");
  });

  it("ranks by success_count weighted by recency", async () => {
    const recent = makeRow({
      id: 1,
      capability_identifier: "recent.com",
      success_count: 3,
      last_success_at: new Date().toISOString(),
    });
    const old = makeRow({
      id: 2,
      capability_identifier: "old.com",
      success_count: 10,
      last_success_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    });
    const source = makeSource([old, recent]);
    const results = await resolveFromCapabilityMemory(makeRequest(), source);

    expect(results).toHaveLength(2);
    // Old entry has high success_count but decayed recency
    // Recent entry has lower count but full recency weight
    // 10 * (1 - 30*0.02) = 10 * 0.4 = 4
    // 3 * 1.0 = 3
    // So old should still rank first here
    expect(results[0].connector_url).toBe("https://old.com");
    expect(results[1].connector_url).toBe("https://recent.com");
  });

  it("returns empty for no matches", async () => {
    const source = makeSource([makeRow({ capability_type: "api_call" })]);
    const results = await resolveFromCapabilityMemory(
      makeRequest({ query: "zzz_nonexistent" }),
      source,
    );
    expect(results).toHaveLength(0);
  });

  it("respects max_results", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ id: i, capability_identifier: `site${i}.com` }),
    );
    const source = makeSource(rows);
    const results = await resolveFromCapabilityMemory(makeRequest({ max_results: 3 }), source);
    expect(results).toHaveLength(3);
  });

  it("preserves URL if identifier is already a URL", async () => {
    const source = makeSource([makeRow({ capability_identifier: "https://api.example.com/v2" })]);
    const results = await resolveFromCapabilityMemory(makeRequest(), source);
    expect(results[0].connector_url).toBe("https://api.example.com/v2");
  });

  it("includes metadata in results", async () => {
    const source = makeSource([makeRow({ success_count: 7, result_summary: "Got price data" })]);
    const results = await resolveFromCapabilityMemory(makeRequest(), source);
    const meta = results[0].metadata as Record<string, unknown>;
    expect(meta.success_count).toBe(7);
    expect(meta.result_summary).toBe("Got price data");
  });
});

describe("McpToolStrategy", () => {
  function makeToolSource(
    tools: Array<{ id: string; description: string; keywords: readonly string[] }>,
  ): McpToolSource {
    return { listTools: () => tools };
  }

  it("matches tool by id", () => {
    const source = makeToolSource([
      {
        id: "mcp.github.search",
        description: "Search GitHub repos",
        keywords: ["github", "search"],
      },
    ]);
    const results = resolveFromMcpTools(makeRequest({ query: "github" }), source);
    expect(results).toHaveLength(1);
    expect(results[0].strategy).toBe("mcp");
    expect(results[0].connector_url).toBe("mcp://github/search");
  });

  it("matches tool by description", () => {
    const source = makeToolSource([
      { id: "mcp.db.query", description: "Execute SQL database queries", keywords: ["sql"] },
    ]);
    const results = resolveFromMcpTools(makeRequest({ query: "database" }), source);
    expect(results).toHaveLength(1);
  });

  it("matches tool by keywords", () => {
    const source = makeToolSource([
      { id: "mcp.fs.read", description: "Read files", keywords: ["file", "read", "open"] },
    ]);
    const results = resolveFromMcpTools(makeRequest({ query: "read file" }), source);
    expect(results).toHaveLength(1);
  });

  it("returns empty when no tools match", () => {
    const source = makeToolSource([
      { id: "mcp.fs.read", description: "Read files", keywords: ["file"] },
    ]);
    const results = resolveFromMcpTools(makeRequest({ query: "zzz_nonexistent" }), source);
    expect(results).toHaveLength(0);
  });

  it("ranks by fuzzy score", () => {
    const source = makeToolSource([
      { id: "mcp.a.tool", description: "Does something", keywords: ["alpha"] },
      {
        id: "mcp.b.search",
        description: "Search the web for results",
        keywords: ["search", "web"],
      },
    ]);
    const results = resolveFromMcpTools(makeRequest({ query: "search" }), source);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].connector_url).toBe("mcp://b/search");
  });

  it("respects max_results", () => {
    const tools = Array.from({ length: 10 }, (_, i) => ({
      id: `mcp.s.tool${i}`,
      description: `Tool ${i} for testing`,
      keywords: ["testing"],
    }));
    const source = makeToolSource(tools);
    const results = resolveFromMcpTools(makeRequest({ query: "testing", max_results: 2 }), source);
    expect(results).toHaveLength(2);
  });
});
