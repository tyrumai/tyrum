import { createHash } from "node:crypto";
import type { GatewayStateMode } from "../runtime-state/mode.js";

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
  {
    id: "tool.automation.schedule.list",
    description: "List automation schedules for the current or specified agent/workspace scope.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["automation", "schedule", "heartbeat", "cron", "list"],
    inputSchema: {
      type: "object",
      properties: {
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.get",
    description: "Fetch a single automation schedule by id.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["automation", "schedule", "heartbeat", "cron", "get"],
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.create",
    description: "Create a recurring automation schedule such as a heartbeat or cron job.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "heartbeat", "cron", "create"],
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        cadence: {
          type: "object",
          description:
            "Either {type:'interval', interval_ms} or {type:'cron', expression, timezone}.",
        },
        execution: {
          type: "object",
          description: "Either agent_turn, playbook, or steps execution.",
        },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["kind", "cadence", "execution"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.update",
    description: "Update an existing automation schedule.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "heartbeat", "cron", "update"],
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        cadence: { type: "object" },
        execution: { type: "object" },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.pause",
    description: "Pause an automation schedule without deleting it.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "pause", "disable"],
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.resume",
    description: "Resume a paused automation schedule.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "resume", "enable"],
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.delete",
    description: "Delete an automation schedule.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "delete", "remove"],
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
];

function shortToolIdHash(toolId: string): string {
  return createHash("sha256").update(toolId).digest("hex").slice(0, 8);
}

function sanitizeToolIdForModel(toolId: string): string {
  const sanitized = toolId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : `tool_${shortToolIdHash(toolId)}`;
}

function isReservedModelToolName(input: {
  candidate: string;
  toolId: string;
  canonicalToolIds: ReadonlySet<string>;
  usedNames: ReadonlySet<string>;
}): boolean {
  return (
    input.usedNames.has(input.candidate) ||
    (input.canonicalToolIds.has(input.candidate) && input.candidate !== input.toolId)
  );
}

export function buildModelToolNameMap(toolIds: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  const canonicalToolIds = new Set<string>();
  const normalizedToolIds: string[] = [];

  for (const rawToolId of toolIds) {
    const toolId = rawToolId.trim();
    if (toolId.length === 0 || canonicalToolIds.has(toolId)) continue;
    canonicalToolIds.add(toolId);
    normalizedToolIds.push(toolId);
  }

  const usedNames = new Set<string>();

  for (const toolId of normalizedToolIds) {
    const baseName = sanitizeToolIdForModel(toolId);
    let candidate = baseName;
    if (
      isReservedModelToolName({
        candidate,
        toolId,
        canonicalToolIds,
        usedNames,
      })
    ) {
      candidate = `${baseName}_${shortToolIdHash(toolId)}`;
    }

    let suffix = 1;
    while (
      isReservedModelToolName({
        candidate,
        toolId,
        canonicalToolIds,
        usedNames,
      })
    ) {
      candidate = `${baseName}_${String(suffix)}`;
      suffix += 1;
    }

    names.set(toolId, candidate);
    usedNames.add(candidate);
  }

  return names;
}

export function registerModelTool<T>(
  toolSet: Record<string, T>,
  toolId: string,
  tool: T,
  modelToolNames: ReadonlyMap<string, string>,
): string {
  const canonicalToolId = toolId.trim();
  const modelToolName = modelToolNames.get(canonicalToolId) ?? canonicalToolId;
  const existingModelTool = toolSet[modelToolName];

  if (existingModelTool !== undefined && existingModelTool !== tool) {
    throw new Error(`model tool name collision for '${modelToolName}'`);
  }

  toolSet[modelToolName] = tool;
  if (modelToolName !== canonicalToolId) {
    const existingCanonicalTool = toolSet[canonicalToolId];
    if (existingCanonicalTool !== undefined && existingCanonicalTool !== tool) {
      throw new Error(`model tool alias collision for '${canonicalToolId}'`);
    }

    Object.defineProperty(toolSet, canonicalToolId, {
      value: tool,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }

  return modelToolName;
}

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

export function isBuiltinToolAvailableInStateMode(
  toolId: string,
  stateMode: GatewayStateMode,
): boolean {
  if (stateMode === "local") {
    return true;
  }

  return toolId !== "tool.fs.read" && toolId !== "tool.fs.write" && toolId !== "tool.exec";
}

export function selectToolDirectory(
  userPrompt: string,
  allowlist: readonly string[],
  mcpTools: readonly ToolDescriptor[],
  limit = 8,
  allowRequiresConfirmation = true,
  stateMode: GatewayStateMode = "local",
): ToolDescriptor[] {
  const available: ToolDescriptor[] = [];

  for (const tool of BUILTIN_TOOL_REGISTRY) {
    if (
      isBuiltinToolAvailableInStateMode(tool.id, stateMode) &&
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
    .toSorted((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
    .slice(0, limit)
    .map((entry) => entry.tool);
}
