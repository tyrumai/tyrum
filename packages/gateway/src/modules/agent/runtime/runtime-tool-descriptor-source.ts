import type { AgentConfig, ToolTaxonomyTier } from "@tyrum/contracts";
import type { PluginRegistry } from "../../plugins/registry.js";
import { materializeAllowedAgentIds } from "../access-config.js";
import type { McpManager } from "../mcp-manager.js";
import { buildSecretClipboardToolDescriptor } from "../tool-secret-definitions.js";
import {
  isBuiltinToolAvailableInStateMode,
  isToolAllowed,
  listBuiltinToolDescriptors,
  type ToolDescriptor,
  withResolvedToolDescriptorTaxonomy,
} from "../tools.js";
import type { AgentLoadedContext } from "./types.js";
import type { GatewayStateMode } from "../../runtime-state/mode.js";
import { resolvePolicyGatedPluginToolExposure } from "./plugin-tool-policy.js";

type ToolExposureConfig = Pick<
  AgentConfig["tools"],
  "bundle" | "tier" | "default_mode" | "allow" | "deny"
>;
type McpExposureConfig = Pick<AgentConfig["mcp"], "bundle" | "tier">;
type RuntimeExposureSurface = "tools" | "mcp";

const TOOL_TIER_ORDER: Record<ToolTaxonomyTier, number> = {
  default: 0,
  advanced: 1,
};

function resolveRuntimeExposureBundle(
  surface: RuntimeExposureSurface,
  config: Pick<ToolExposureConfig, "bundle" | "tier"> | Pick<McpExposureConfig, "bundle" | "tier">,
): string | undefined {
  if (config.bundle) {
    return config.bundle;
  }
  if (config.tier) {
    return surface === "mcp" ? "workspace-default" : "authoring-core";
  }
  return undefined;
}

function hasCanonicalExposureSelector(
  config: Pick<ToolExposureConfig, "bundle" | "tier"> | Pick<McpExposureConfig, "bundle" | "tier">,
): boolean {
  return config.bundle !== undefined || config.tier !== undefined;
}

function isRawMcpTool(tool: ToolDescriptor): boolean {
  return tool.source === "mcp" || tool.id.startsWith("mcp.");
}

function isPluginTool(tool: ToolDescriptor): boolean {
  return tool.source === "plugin";
}

function matchesExposureTier(
  selectedTier: ToolTaxonomyTier | undefined,
  toolTier: ToolTaxonomyTier | null | undefined,
): boolean {
  if (toolTier === null || toolTier === undefined) {
    return false;
  }
  if (!selectedTier) {
    return true;
  }
  return TOOL_TIER_ORDER[toolTier] <= TOOL_TIER_ORDER[selectedTier];
}

function matchesExposureBundle(
  surface: RuntimeExposureSurface,
  bundle: string | undefined,
  tool: ToolDescriptor,
): boolean {
  if (tool.taxonomy?.visibility !== "public") {
    return false;
  }

  switch (bundle) {
    case "authoring-core":
      return !isRawMcpTool(tool) && !isPluginTool(tool);
    case "workspace-default":
      return surface === "mcp" ? isRawMcpTool(tool) : !isPluginTool(tool);
    default:
      return false;
  }
}

function resolveCanonicalToolExposureIds(params: {
  surface: RuntimeExposureSurface;
  config: Pick<ToolExposureConfig, "bundle" | "tier"> | Pick<McpExposureConfig, "bundle" | "tier">;
  candidates: readonly ToolDescriptor[];
}): string[] {
  const bundle = resolveRuntimeExposureBundle(params.surface, params.config);
  const selectedTier = params.config.tier;
  const selected = params.candidates.filter(
    (tool) =>
      matchesExposureBundle(params.surface, bundle, tool) &&
      matchesExposureTier(selectedTier, tool.taxonomy?.tier),
  );

  return selected.map((tool) => tool.id);
}

function resolveCompatibilityToolExposureIds(
  config: ToolExposureConfig,
  candidates: readonly ToolDescriptor[],
): string[] {
  if (!hasCanonicalExposureSelector(config)) {
    return materializeAllowedAgentIds(config, candidates).map((tool) => tool.id);
  }

  const explicitAllowEntries = config.allow.filter((entry) => {
    const normalized = entry.trim();
    return normalized.length > 0 && !normalized.includes("*") && !normalized.includes("?");
  });
  const selectedIds = new Set<string>();

  for (const tool of candidates) {
    if (isToolAllowed(explicitAllowEntries, tool.id)) {
      selectedIds.add(tool.id);
    }
  }

  return [...selectedIds];
}

function selectToolDescriptorsById(
  candidates: readonly ToolDescriptor[],
  selectedIds: ReadonlySet<string>,
): ToolDescriptor[] {
  return candidates.filter((tool) => selectedIds.has(tool.id));
}

function resolveToolDescriptorsForSurface(params: {
  surface: RuntimeExposureSurface;
  canonicalConfig:
    | Pick<ToolExposureConfig, "bundle" | "tier">
    | Pick<McpExposureConfig, "bundle" | "tier">;
  compatibilityConfig: ToolExposureConfig;
  candidates: readonly ToolDescriptor[];
}): ToolDescriptor[] {
  const selectedIds = new Set<string>();

  for (const toolId of resolveCanonicalToolExposureIds({
    surface: params.surface,
    config: params.canonicalConfig,
    candidates: params.candidates,
  })) {
    selectedIds.add(toolId);
  }

  for (const toolId of resolveCompatibilityToolExposureIds(
    params.compatibilityConfig,
    params.candidates,
  )) {
    selectedIds.add(toolId);
  }

  for (const tool of params.candidates) {
    if (isToolAllowed(params.compatibilityConfig.deny, tool.id)) {
      selectedIds.delete(tool.id);
    }
  }

  return selectToolDescriptorsById(params.candidates, selectedIds);
}

function canDiscoverMcpTools(params: {
  toolConfig: AgentConfig["tools"];
  mcpConfig: AgentConfig["mcp"];
}): boolean {
  if (hasCanonicalExposureSelector(params.mcpConfig)) {
    return true;
  }

  if (params.toolConfig.default_mode === "allow") {
    return true;
  }

  return params.toolConfig.allow.some((entry: string) => {
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
  return normalizeToolDescriptors(pluginTools);
}

function normalizeToolDescriptors(tools: readonly ToolDescriptor[]): ToolDescriptor[] {
  const normalized: ToolDescriptor[] = [];

  for (const tool of tools) {
    const id = tool.id.trim();
    if (!id) {
      continue;
    }
    normalized.push(
      withResolvedToolDescriptorTaxonomy({
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
        taxonomy: tool.taxonomy,
      }),
    );
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
  const mcpTools = normalizeToolDescriptors(
    canDiscoverMcpTools({
      toolConfig: params.ctx.config.tools,
      mcpConfig: params.ctx.config.mcp,
    })
      ? await params.mcpManager.listToolDescriptors(params.ctx.mcpServers)
      : [],
  );
  const dynamicBuiltinTools = [
    buildSecretClipboardToolDescriptor(params.ctx.config.secret_refs),
  ].filter((tool): tool is ToolDescriptor => tool !== undefined);
  const builtinTools = [...listBuiltinToolDescriptors(), ...dynamicBuiltinTools];
  const pluginToolsRaw = normalizePluginTools(params.plugins?.getToolDescriptors() ?? []);
  const builtinToolsSelected = resolveToolDescriptorsForSurface({
    surface: "tools",
    canonicalConfig: params.ctx.config.tools,
    compatibilityConfig: params.ctx.config.tools,
    candidates: builtinTools.filter((tool) => !isPluginTool(tool) && !isRawMcpTool(tool)),
  });
  const mcpToolsSelected = resolveToolDescriptorsForSurface({
    surface: "mcp",
    canonicalConfig: params.ctx.config.mcp,
    compatibilityConfig: params.ctx.config.tools,
    candidates: mcpTools,
  });
  const pluginToolsSelected = materializeAllowedAgentIds(params.ctx.config.tools, pluginToolsRaw);
  const baseToolAllowlist = [
    ...builtinToolsSelected.map((tool) => tool.id),
    ...mcpToolsSelected.map((tool) => tool.id),
    ...pluginToolsSelected.map((tool) => tool.id),
  ];
  const { allowlist: toolAllowlist, pluginTools } = (
    params.resolvePluginToolExposure ?? resolvePolicyGatedPluginToolExposure
  )({
    allowlist: baseToolAllowlist,
    pluginTools: pluginToolsSelected,
  });

  return {
    availableTools: dedupeToolDescriptors([
      ...builtinToolsSelected.filter(
        (tool) =>
          isBuiltinToolAvailableInStateMode(tool.id, params.stateMode) &&
          isToolAllowed(toolAllowlist, tool.id),
      ),
      ...mcpToolsSelected.filter((tool) => isToolAllowed(toolAllowlist, tool.id)),
      ...pluginTools,
    ]),
    toolAllowlist,
    promptSelectableTools: dedupeToolDescriptors([
      ...mcpToolsSelected.filter((tool) => isToolAllowed(toolAllowlist, tool.id)),
      ...pluginTools,
      ...dynamicBuiltinTools.filter((tool) => isToolAllowed(toolAllowlist, tool.id)),
    ]),
  };
}
