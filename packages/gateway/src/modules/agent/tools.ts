import type { McpServerSpec } from "@tyrum/schemas";

export type ToolRisk = "low" | "medium" | "high";

export interface ToolDescriptor {
  id: string;
  description: string;
  risk: ToolRisk;
  requires_confirmation: boolean;
  keywords: readonly string[];
}

const BUILTIN_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "tool.fs.read",
    description: "Read files from the local filesystem.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["read", "file", "open", "inspect", "view", "log"],
  },
  {
    id: "tool.fs.write",
    description: "Write or patch files in the local filesystem.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["write", "edit", "update", "patch", "create", "file"],
  },
  {
    id: "tool.exec",
    description: "Execute shell commands on the local machine.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["run", "command", "shell", "terminal", "execute", "build"],
  },
  {
    id: "tool.http.fetch",
    description: "Make outbound HTTP requests.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["fetch", "http", "api", "request", "web", "endpoint"],
  },
  {
    id: "tool.node.dispatch",
    description: "Dispatch tasks to connected node capabilities.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["node", "device", "screen", "automation", "dispatch"],
  },
];

export function isToolAllowed(allowlist: readonly string[], toolId: string): boolean {
  for (const entry of allowlist) {
    if (entry === "*") return true;
    if (entry.endsWith("*")) {
      const prefix = entry.slice(0, -1);
      if (toolId.startsWith(prefix)) return true;
      continue;
    }
    if (entry === toolId) return true;
  }
  return false;
}

function mcpServerToTool(spec: McpServerSpec): ToolDescriptor {
  return {
    id: `mcp.${spec.id}.invoke`,
    description: `Invoke tools exposed by MCP server '${spec.name}'.`,
    risk: "medium",
    requires_confirmation: true,
    keywords: ["mcp", spec.id.toLowerCase(), spec.name.toLowerCase()],
  };
}

function scoreTool(tool: ToolDescriptor, normalizedPrompt: string): number {
  let score = 0;
  for (const keyword of tool.keywords) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }

  if (tool.risk === "low") {
    score += 0.25;
  }

  return score;
}

export function selectToolDirectory(
  userPrompt: string,
  allowlist: readonly string[],
  enabledMcpServers: readonly McpServerSpec[],
  limit = 8,
): ToolDescriptor[] {
  const available: ToolDescriptor[] = [];

  for (const tool of BUILTIN_TOOL_REGISTRY) {
    if (isToolAllowed(allowlist, tool.id)) {
      available.push(tool);
    }
  }

  for (const server of enabledMcpServers) {
    const tool = mcpServerToTool(server);
    if (isToolAllowed(allowlist, tool.id) || isToolAllowed(allowlist, "mcp.*")) {
      available.push(tool);
    }
  }

  const normalizedPrompt = userPrompt.toLowerCase();
  return available
    .map((tool) => ({ tool, score: scoreTool(tool, normalizedPrompt) }))
    .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
    .slice(0, limit)
    .map((entry) => entry.tool);
}
