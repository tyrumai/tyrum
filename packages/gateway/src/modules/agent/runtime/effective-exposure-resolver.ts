import type { AgentConfig, ToolTaxonomyTier } from "@tyrum/contracts";
import { isAgentAccessAllowed } from "../access-config.js";
import {
  isBuiltinToolAvailableInStateMode,
  isToolAllowed,
  isToolAllowedWithDenylist,
  type ToolDescriptor,
} from "../tools.js";
import type { GatewayStateMode } from "../../runtime-state/mode.js";

type ToolExposureConfig = Pick<
  AgentConfig["tools"],
  "bundle" | "tier" | "default_mode" | "allow" | "deny"
>;
type McpExposureConfig = Pick<AgentConfig["mcp"], "bundle" | "tier">;
type RuntimeExposureSurface = "tools" | "mcp";
type CanonicalExposureSelectorConfig =
  | Pick<ToolExposureConfig, "bundle" | "tier">
  | Pick<McpExposureConfig, "bundle" | "tier">;

export type EffectiveToolExposureReason =
  | "enabled"
  | "disabled_by_agent_allowlist"
  | "disabled_by_agent_bundle"
  | "disabled_by_agent_denylist"
  | "disabled_by_agent_tier"
  | "disabled_by_execution_profile"
  | "disabled_by_plugin_opt_in"
  | "disabled_by_plugin_policy"
  | "disabled_by_state_mode"
  | "disabled_invalid_schema";

export type EffectiveToolExposureClass = "builtin" | "builtin_mcp" | "mcp" | "plugin";

export type EffectiveToolExposureVerdict = {
  descriptor: ToolDescriptor;
  exposureClass: EffectiveToolExposureClass;
  enabledByAgent: boolean;
  enabled: boolean;
  reason: EffectiveToolExposureReason;
};

export type ResolveEffectiveToolExposureParams = {
  candidates: readonly ToolDescriptor[];
  toolConfig: ToolExposureConfig;
  mcpConfig: McpExposureConfig;
  stateMode?: GatewayStateMode;
  invalidSchemaToolIds?: readonly string[];
  pluginPolicyAllowedToolIds?: readonly string[];
  executionProfile?: {
    allowlist: readonly string[];
    denylist?: readonly string[];
  };
};

const TOOL_TIER_ORDER: Record<ToolTaxonomyTier, number> = {
  default: 0,
  advanced: 1,
};

function resolveRuntimeExposureBundle(
  surface: RuntimeExposureSurface,
  config: CanonicalExposureSelectorConfig,
): string | undefined {
  if (config.bundle) {
    return config.bundle;
  }
  if (config.tier) {
    return surface === "mcp" ? "workspace-default" : "authoring-core";
  }
  return undefined;
}

export function hasCanonicalExposureSelector(config: CanonicalExposureSelectorConfig): boolean {
  return config.bundle !== undefined || config.tier !== undefined;
}

function isRawMcpTool(tool: ToolDescriptor): boolean {
  return tool.source === "mcp" || tool.id.startsWith("mcp.");
}

export function isPluginExposureTool(tool: Pick<ToolDescriptor, "id" | "source">): boolean {
  return (
    tool.source === "plugin" || (tool.source === undefined && tool.id.trim().startsWith("plugin."))
  );
}

function isBuiltinExposureClass(
  exposureClass: EffectiveToolExposureClass,
): exposureClass is "builtin" | "builtin_mcp" {
  return exposureClass === "builtin" || exposureClass === "builtin_mcp";
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
      return !isRawMcpTool(tool) && !isPluginExposureTool(tool);
    case "workspace-default":
      return surface === "mcp" ? isRawMcpTool(tool) : !isPluginExposureTool(tool);
    default:
      return false;
  }
}

function resolveExposureClass(tool: ToolDescriptor): EffectiveToolExposureClass {
  if (isPluginExposureTool(tool)) {
    return "plugin";
  }
  if (isRawMcpTool(tool)) {
    return "mcp";
  }
  if (tool.source === "builtin_mcp") {
    return "builtin_mcp";
  }
  return "builtin";
}

function resolveExposureSurface(exposureClass: EffectiveToolExposureClass): RuntimeExposureSurface {
  return exposureClass === "mcp" ? "mcp" : "tools";
}

function extractExplicitAllowEntries(allowEntries: readonly string[]): string[] {
  return allowEntries.filter((entry) => {
    const normalized = entry.trim();
    return normalized.length > 0 && !normalized.includes("*") && !normalized.includes("?");
  });
}

function matchesCompatibilitySelection(params: {
  toolId: string;
  toolConfig: ToolExposureConfig;
  explicitToolAllowEntries: readonly string[];
}): boolean {
  if (!hasCanonicalExposureSelector(params.toolConfig)) {
    return isAgentAccessAllowed(params.toolConfig, params.toolId);
  }

  return isToolAllowed(params.explicitToolAllowEntries, params.toolId);
}

function resolveNonPluginDisabledReason(params: {
  descriptor: ToolDescriptor;
  exposureClass: Exclude<EffectiveToolExposureClass, "plugin">;
  toolConfig: ToolExposureConfig;
  mcpConfig: McpExposureConfig;
}): Extract<
  EffectiveToolExposureReason,
  "disabled_by_agent_allowlist" | "disabled_by_agent_bundle" | "disabled_by_agent_tier"
> {
  const surface = resolveExposureSurface(params.exposureClass);
  const canonicalConfig = params.exposureClass === "mcp" ? params.mcpConfig : params.toolConfig;

  if (!hasCanonicalExposureSelector(canonicalConfig)) {
    return "disabled_by_agent_allowlist";
  }

  const bundle = resolveRuntimeExposureBundle(surface, canonicalConfig);
  if (!matchesExposureBundle(surface, bundle, params.descriptor)) {
    return "disabled_by_agent_bundle";
  }
  if (!matchesExposureTier(canonicalConfig.tier, params.descriptor.taxonomy?.tier)) {
    return "disabled_by_agent_tier";
  }
  return "disabled_by_agent_allowlist";
}

function resolveEnabledByAgent(params: {
  descriptor: ToolDescriptor;
  exposureClass: EffectiveToolExposureClass;
  toolConfig: ToolExposureConfig;
  mcpConfig: McpExposureConfig;
  explicitToolAllowEntries: readonly string[];
  pluginPolicyAllowedToolIds?: ReadonlySet<string>;
}): Pick<EffectiveToolExposureVerdict, "enabledByAgent" | "reason"> {
  if (isToolAllowed(params.toolConfig.deny, params.descriptor.id)) {
    return {
      enabledByAgent: false,
      reason: "disabled_by_agent_denylist",
    };
  }

  if (params.exposureClass === "plugin") {
    if (!isToolAllowed(params.explicitToolAllowEntries, params.descriptor.id)) {
      return {
        enabledByAgent: false,
        reason: "disabled_by_plugin_opt_in",
      };
    }
    if (
      params.pluginPolicyAllowedToolIds &&
      !params.pluginPolicyAllowedToolIds.has(params.descriptor.id)
    ) {
      return {
        enabledByAgent: false,
        reason: "disabled_by_plugin_policy",
      };
    }
    return {
      enabledByAgent: true,
      reason: "enabled",
    };
  }

  const surface = resolveExposureSurface(params.exposureClass);
  const canonicalConfig = params.exposureClass === "mcp" ? params.mcpConfig : params.toolConfig;
  const selectedByCanonical =
    matchesExposureBundle(
      surface,
      resolveRuntimeExposureBundle(surface, canonicalConfig),
      params.descriptor,
    ) && matchesExposureTier(canonicalConfig.tier, params.descriptor.taxonomy?.tier);
  const selectedByCompatibility = matchesCompatibilitySelection({
    toolId: params.descriptor.id,
    toolConfig: params.toolConfig,
    explicitToolAllowEntries: params.explicitToolAllowEntries,
  });

  if (selectedByCanonical || selectedByCompatibility) {
    return {
      enabledByAgent: true,
      reason: "enabled",
    };
  }

  return {
    enabledByAgent: false,
    reason: resolveNonPluginDisabledReason({
      descriptor: params.descriptor,
      exposureClass: params.exposureClass,
      toolConfig: params.toolConfig,
      mcpConfig: params.mcpConfig,
    }),
  };
}

function resolveFinalExposure(params: {
  descriptor: ToolDescriptor;
  exposureClass: EffectiveToolExposureClass;
  enabledByAgent: boolean;
  agentReason: EffectiveToolExposureReason;
  stateMode?: GatewayStateMode;
  invalidSchemaToolIds?: ReadonlySet<string>;
  executionProfile?: ResolveEffectiveToolExposureParams["executionProfile"];
}): Pick<EffectiveToolExposureVerdict, "enabled" | "reason"> {
  if (params.invalidSchemaToolIds?.has(params.descriptor.id)) {
    return {
      enabled: false,
      reason: "disabled_invalid_schema",
    };
  }

  if (
    params.stateMode &&
    isBuiltinExposureClass(params.exposureClass) &&
    !isBuiltinToolAvailableInStateMode(params.descriptor.id, params.stateMode)
  ) {
    return {
      enabled: false,
      reason: "disabled_by_state_mode",
    };
  }

  if (!params.enabledByAgent) {
    return {
      enabled: false,
      reason: params.agentReason,
    };
  }

  if (
    params.executionProfile &&
    !isToolAllowedWithDenylist(
      params.executionProfile.allowlist,
      params.executionProfile.denylist,
      params.descriptor.id,
    )
  ) {
    return {
      enabled: false,
      reason: "disabled_by_execution_profile",
    };
  }

  return {
    enabled: true,
    reason: "enabled",
  };
}

export function resolveEffectiveToolExposureVerdicts(
  params: ResolveEffectiveToolExposureParams,
): EffectiveToolExposureVerdict[] {
  const explicitToolAllowEntries = extractExplicitAllowEntries(params.toolConfig.allow);
  const invalidSchemaToolIds =
    params.invalidSchemaToolIds === undefined ? undefined : new Set(params.invalidSchemaToolIds);
  const pluginPolicyAllowedToolIds =
    params.pluginPolicyAllowedToolIds === undefined
      ? undefined
      : new Set(params.pluginPolicyAllowedToolIds);

  return params.candidates.map((descriptor) => {
    const exposureClass = resolveExposureClass(descriptor);
    const agentExposure = resolveEnabledByAgent({
      descriptor,
      exposureClass,
      toolConfig: params.toolConfig,
      mcpConfig: params.mcpConfig,
      explicitToolAllowEntries,
      pluginPolicyAllowedToolIds,
    });
    const finalExposure = resolveFinalExposure({
      descriptor,
      exposureClass,
      enabledByAgent: agentExposure.enabledByAgent,
      agentReason: agentExposure.reason,
      stateMode: params.stateMode,
      invalidSchemaToolIds,
      executionProfile: params.executionProfile,
    });

    return {
      descriptor,
      exposureClass,
      enabledByAgent: agentExposure.enabledByAgent,
      enabled: finalExposure.enabled,
      reason: finalExposure.reason,
    };
  });
}
