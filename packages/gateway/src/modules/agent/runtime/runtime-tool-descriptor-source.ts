import type { AgentConfig } from "@tyrum/contracts";
import type { PluginRegistry } from "../../plugins/registry.js";
import { materializeAllowedAgentIds } from "../access-config.js";
import type { McpManager } from "../mcp-manager.js";
import { buildSecretClipboardToolDescriptor } from "../tool-secret-definitions.js";
import {
  isBuiltinToolAvailableInStateMode,
  isToolAllowed,
  listBuiltinToolDescriptors,
  type ToolDescriptor,
} from "../tools.js";
import type { AgentLoadedContext } from "./types.js";
import type { GatewayStateMode } from "../../runtime-state/mode.js";
import { resolvePolicyGatedPluginToolExposure } from "./plugin-tool-policy.js";

function canDiscoverMcpTools(toolConfig: AgentConfig["tools"]): boolean {
  if (toolConfig.default_mode === "allow") {
    return true;
  }

  return toolConfig.allow.some((entry: string) => {
    const normalized = entry.trim();
    return (
      normalized === "*" || normalized.startsWith("mcp.") || canPatternMatchMcpToolId(normalized)
    );
  });
}

const MCP_TOOL_SHAPE_CHARS = ["m", "c", "p", ".", "x"] as const;
const MCP_TOOL_ACCEPTING_STATE = 7;

function nextMcpToolShapeState(state: number, char: string): number | undefined {
  switch (state) {
    case 0:
      return char === "m" ? 1 : undefined;
    case 1:
      return char === "c" ? 2 : undefined;
    case 2:
      return char === "p" ? 3 : undefined;
    case 3:
      return char === "." ? 4 : undefined;
    case 4:
      return char === "." ? undefined : 5;
    case 5:
      return char === "." ? 6 : 5;
    case 6:
      return char === "." ? undefined : 7;
    case 7:
      return 7;
    default:
      return undefined;
  }
}

export function canPatternMatchMcpToolId(pattern: string): boolean {
  const normalized = pattern.trim();
  if (normalized.length === 0) {
    return false;
  }

  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const visit = (patternIndex: number, shapeState: number): boolean => {
    const key = `${String(patternIndex)}:${String(shapeState)}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(key)) {
      return false;
    }

    if (patternIndex >= normalized.length) {
      const matches = shapeState === MCP_TOOL_ACCEPTING_STATE;
      memo.set(key, matches);
      return matches;
    }

    const token = normalized[patternIndex];
    if (token === undefined) {
      memo.set(key, false);
      return false;
    }

    visiting.add(key);
    let matches = false;
    if (token === "*") {
      matches = visit(patternIndex + 1, shapeState);
      if (!matches) {
        matches = MCP_TOOL_SHAPE_CHARS.some((char) => {
          const nextState = nextMcpToolShapeState(shapeState, char);
          return nextState !== undefined && visit(patternIndex, nextState);
        });
      }
    } else if (token === "?") {
      matches = MCP_TOOL_SHAPE_CHARS.some((char) => {
        const nextState = nextMcpToolShapeState(shapeState, char);
        return nextState !== undefined && visit(patternIndex + 1, nextState);
      });
    } else {
      const nextState = nextMcpToolShapeState(shapeState, token);
      matches = nextState !== undefined && visit(patternIndex + 1, nextState);
    }

    visiting.delete(key);
    memo.set(key, matches);
    return matches;
  };

  return visit(0, 0);
}

function normalizePluginTools(pluginTools: readonly ToolDescriptor[]): ToolDescriptor[] {
  const normalized: ToolDescriptor[] = [];

  for (const tool of pluginTools) {
    const id = tool.id.trim();
    if (!id) {
      continue;
    }
    if (id === tool.id) {
      normalized.push(tool);
      continue;
    }
    normalized.push({
      id,
      description: tool.description,
      effect: tool.effect,
      keywords: tool.keywords,
      inputSchema: tool.inputSchema,
      source: tool.source,
      family: tool.family,
      backingServerId: tool.backingServerId,
      promptGuidance: tool.promptGuidance,
      promptExamples: tool.promptExamples,
      preTurnHydration: tool.preTurnHydration,
      memoryRole: tool.memoryRole,
    });
  }

  return normalized;
}

function dedupeToolDescriptors(tools: readonly ToolDescriptor[]): ToolDescriptor[] {
  return Array.from(new Map(tools.map((tool) => [tool.id, tool] as const)).values());
}

export type RuntimeToolDescriptorSource = {
  availableTools: ToolDescriptor[];
  toolAllowlist: string[];
  promptSelectableTools: ToolDescriptor[];
};

export async function resolveRuntimeToolDescriptorSource(params: {
  ctx: Pick<AgentLoadedContext, "config" | "mcpServers">;
  mcpManager: McpManager;
  plugins: PluginRegistry | undefined;
  stateMode: GatewayStateMode;
  resolvePluginToolExposure?: typeof resolvePolicyGatedPluginToolExposure;
}): Promise<RuntimeToolDescriptorSource> {
  const mcpTools = canDiscoverMcpTools(params.ctx.config.tools)
    ? await params.mcpManager.listToolDescriptors(params.ctx.mcpServers)
    : [];
  const dynamicBuiltinTools = [
    buildSecretClipboardToolDescriptor(params.ctx.config.secret_refs),
  ].filter((tool): tool is ToolDescriptor => tool !== undefined);
  const builtinTools = [...listBuiltinToolDescriptors(), ...dynamicBuiltinTools];
  const pluginToolsRaw = normalizePluginTools(params.plugins?.getToolDescriptors() ?? []);
  const baseToolAllowlist = materializeAllowedAgentIds(params.ctx.config.tools, [
    ...builtinTools,
    ...mcpTools,
    ...pluginToolsRaw,
  ]).map((tool) => tool.id);
  const { allowlist: toolAllowlist, pluginTools } = (
    params.resolvePluginToolExposure ?? resolvePolicyGatedPluginToolExposure
  )({
    allowlist: baseToolAllowlist,
    pluginTools: pluginToolsRaw,
  });

  return {
    availableTools: dedupeToolDescriptors([
      ...builtinTools.filter(
        (tool) =>
          isBuiltinToolAvailableInStateMode(tool.id, params.stateMode) &&
          isToolAllowed(toolAllowlist, tool.id),
      ),
      ...mcpTools,
      ...pluginTools,
    ]),
    toolAllowlist,
    promptSelectableTools: dedupeToolDescriptors([
      ...mcpTools,
      ...pluginTools,
      ...dynamicBuiltinTools,
    ]),
  };
}
