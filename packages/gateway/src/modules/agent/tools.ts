export type ToolRisk = "low" | "medium" | "high";

export interface ToolDescriptor {
  id: string;
  description: string;
  risk: ToolRisk;
  requires_confirmation: boolean;
  keywords: readonly string[];
  inputSchema?: Record<string, unknown>;
}

const BUILTIN_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "tool.fs.read",
    description: "Read files from the local filesystem.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["read", "file", "open", "inspect", "view", "log"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path to the file." },
        offset: {
          type: "number",
          description: "Optional line offset to start reading from (0-indexed).",
        },
        limit: {
          type: "number",
          description: "Optional maximum number of lines to return.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.fs.write",
    description: "Write or patch files in the local filesystem.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["write", "edit", "update", "patch", "create", "file"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path to write." },
        content: { type: "string", description: "File content to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.exec",
    description: "Execute shell commands on the local machine.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["run", "command", "shell", "terminal", "execute", "build"],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        cwd: {
          type: "string",
          description: "Optional working directory (absolute or workspace-relative).",
        },
        timeout_ms: { type: "number", description: "Optional timeout in milliseconds." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.http.fetch",
    description: "Make outbound HTTP requests.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["fetch", "http", "api", "request", "web", "endpoint"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch." },
        method: { type: "string", description: "HTTP method (GET, POST, etc.). Defaults to GET." },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Optional HTTP headers.",
        },
        body: { type: "string", description: "Optional request body." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.node.dispatch",
    description: "Dispatch tasks to connected node capabilities.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["node", "device", "screen", "automation", "dispatch"],
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Capability descriptor id (example: tyrum.desktop).",
        },
        action: { type: "string", description: "ActionPrimitiveKind (example: Desktop)." },
        args: {
          type: "object",
          additionalProperties: {},
          description: "Optional action arguments.",
        },
        timeout_ms: {
          type: "number",
          description: "Optional timeout in milliseconds (default: 30000).",
        },
      },
      required: ["capability", "action"],
      additionalProperties: false,
    },
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
  mcpTools: readonly ToolDescriptor[],
  limit = 8,
  allowRequiresConfirmation = true,
): ToolDescriptor[] {
  const available: ToolDescriptor[] = [];

  for (const tool of BUILTIN_TOOL_REGISTRY) {
    if (
      isToolAllowed(allowlist, tool.id) &&
      (allowRequiresConfirmation || !tool.requires_confirmation)
    ) {
      available.push(tool);
    }
  }

  for (const tool of mcpTools) {
    if (
      isToolAllowed(allowlist, tool.id) &&
      (allowRequiresConfirmation || !tool.requires_confirmation)
    ) {
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
