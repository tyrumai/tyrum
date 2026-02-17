/**
 * Discovery strategy that resolves queries against MCP tool descriptors.
 *
 * Performs fuzzy matching of the query against tool id, description, and keywords.
 */

import type { DiscoveryRequest, DiscoveryResolution } from "@tyrum/schemas";

export interface McpToolDescriptor {
  id: string;
  description: string;
  keywords: readonly string[];
}

export interface McpToolSource {
  listTools(): readonly McpToolDescriptor[];
}

function fuzzyScore(query: string, tool: McpToolDescriptor): number {
  const q = query.toLowerCase();
  let score = 0;

  // Exact substring match in id
  if (tool.id.toLowerCase().includes(q)) {
    score += 3;
  }

  // Substring match in description
  if (tool.description.toLowerCase().includes(q)) {
    score += 2;
  }

  // Keyword matches — each matching keyword adds 1
  const queryTokens = q.split(/\s+/);
  for (const keyword of tool.keywords) {
    const kw = keyword.toLowerCase();
    for (const token of queryTokens) {
      if (kw.includes(token) || token.includes(kw)) {
        score += 1;
      }
    }
  }

  return score;
}

function toolToUrl(toolId: string): string {
  // mcp.serverId.toolName -> mcp://serverId/toolName
  const parts = toolId.split(".");
  if (parts.length >= 3 && parts[0] === "mcp") {
    return `mcp://${parts[1]}/${parts.slice(2).join("/")}`;
  }
  return `mcp://local/${toolId}`;
}

export function resolveFromMcpTools(
  request: DiscoveryRequest,
  source: McpToolSource,
): DiscoveryResolution[] {
  const tools = source.listTools();

  const scored = tools
    .map((tool) => ({ tool, score: fuzzyScore(request.query, tool) }))
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const limit = request.max_results ?? 5;
  return scored.slice(0, limit).map((entry, index) => ({
    strategy: "mcp" as const,
    connector_url: toolToUrl(entry.tool.id),
    label: entry.tool.description,
    rank: index,
    metadata: {
      tool_id: entry.tool.id,
      keywords: entry.tool.keywords,
    },
  }));
}
