import { createHash } from "node:crypto";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import { BUILTIN_TOOL_REGISTRY } from "./tool-catalog.js";

export type ToolEffect = "read_only" | "state_changing";
export type ToolSource = "builtin" | "builtin_mcp" | "mcp" | "plugin";

export interface ToolDescriptor {
  id: string;
  description: string;
  effect: ToolEffect;
  keywords: readonly string[];
  inputSchema?: Record<string, unknown>;
  source?: ToolSource;
  family?: string;
  backingServerId?: string;
}

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
  const normalizedToolId = toolId.trim();
  for (const entry of allowlist) {
    if (entry === "*") return true;
    if (entry.endsWith("*")) {
      const prefix = entry.slice(0, -1);
      if (normalizedToolId.startsWith(prefix)) return true;
      continue;
    }
    if (entry === normalizedToolId) return true;
  }
  return false;
}

export function isToolAllowedWithDenylist(
  allowlist: readonly string[],
  denylist: readonly string[] | undefined,
  toolId: string,
): boolean {
  if (!isToolAllowed(allowlist, toolId)) {
    return false;
  }
  if (!denylist || denylist.length === 0) {
    return true;
  }
  return !isToolAllowed(denylist, toolId);
}

function scoreTool(tool: ToolDescriptor, normalizedPrompt: string): number {
  let score = 0;
  for (const keyword of tool.keywords) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      score += 1;
    }
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

  return !["read", "write", "edit", "apply_patch", "bash", "glob", "grep"].includes(toolId);
}

export function listBuiltinToolDescriptors(): ToolDescriptor[] {
  return BUILTIN_TOOL_REGISTRY.map((tool) => ({ ...tool }));
}

export function resolveBuiltinToolEffect(toolId: string): ToolEffect | undefined {
  return BUILTIN_TOOL_REGISTRY.find((tool) => tool.id === toolId)?.effect;
}

export function selectToolDirectory(
  userPrompt: string,
  allowlist: readonly string[],
  mcpTools: readonly ToolDescriptor[],
  limit = 8,
  stateMode: GatewayStateMode = "local",
): ToolDescriptor[] {
  const available: ToolDescriptor[] = [];

  for (const tool of BUILTIN_TOOL_REGISTRY) {
    if (
      isBuiltinToolAvailableInStateMode(tool.id, stateMode) &&
      isToolAllowed(allowlist, tool.id)
    ) {
      available.push(tool);
    }
  }

  for (const tool of mcpTools) {
    if (isToolAllowed(allowlist, tool.id)) {
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
