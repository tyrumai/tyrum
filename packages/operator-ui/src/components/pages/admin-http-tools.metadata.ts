import type { ToolRegistryListResult } from "@tyrum/operator-app/browser";
import type { BadgeVariant } from "../ui/badge.js";

export type ToolRegistryEntry = ToolRegistryListResult["tools"][number];
export type ToolGroupId = NonNullable<ToolRegistryEntry["group"]> | "unclassified";

export const TOOL_GROUP_ORDER: ToolGroupId[] = [
  "core",
  "retrieval",
  "memory",
  "environment",
  "node",
  "orchestration",
  "extension",
  "unclassified",
];

export const GROUP_LABELS: Record<ToolGroupId, string> = {
  core: "Core",
  retrieval: "Retrieval",
  memory: "Memory",
  environment: "Environment",
  node: "Node-backed",
  orchestration: "Orchestration",
  extension: "Extensions",
  unclassified: "Unclassified",
};

const LIFECYCLE_LABELS: Record<ToolRegistryEntry["lifecycle"], string> = {
  canonical: "Canonical",
  alias: "Alias",
  deprecated: "Deprecated",
};

const VISIBILITY_LABELS: Record<ToolRegistryEntry["visibility"], string> = {
  public: "Public",
  internal: "Internal",
  runtime_only: "Runtime only",
};

const TIER_LABELS: Record<Exclude<ToolRegistryEntry["tier"], null>, string> = {
  default: "Default",
  advanced: "Advanced",
};

export const SOURCE_LABELS: Record<ToolRegistryEntry["source"], string> = {
  builtin: "Built-in",
  builtin_mcp: "Built-in MCP",
  mcp: "MCP",
  plugin: "Plugin",
};

export function effectBadgeVariant(effect: ToolRegistryEntry["effect"]): BadgeVariant {
  return effect === "state_changing" ? "warning" : "success";
}

export function formatToolGroupLabel(group: ToolRegistryEntry["group"]): string {
  return group === null ? GROUP_LABELS.unclassified : GROUP_LABELS[group];
}

export function formatToolLifecycleLabel(lifecycle: ToolRegistryEntry["lifecycle"]): string {
  return LIFECYCLE_LABELS[lifecycle];
}

export function formatToolTierLabel(tier: ToolRegistryEntry["tier"]): string {
  return tier === null ? "No tier" : TIER_LABELS[tier];
}

export function formatToolVisibilityLabel(visibility: ToolRegistryEntry["visibility"]): string {
  return VISIBILITY_LABELS[visibility];
}

export function exposureBadge(tool: ToolRegistryEntry): {
  label: string;
  variant: BadgeVariant;
} {
  switch (tool.effective_exposure.reason) {
    case "enabled":
      return { label: "Exposed", variant: "success" };
    case "disabled_by_agent_bundle":
      return { label: "Blocked by agent bundle", variant: "warning" };
    case "disabled_by_agent_denylist":
      return { label: "Blocked by agent denylist", variant: "warning" };
    case "disabled_by_state_mode":
      return { label: "Blocked by state mode", variant: "warning" };
    case "disabled_by_agent_allowlist":
      return { label: "Blocked by agent allowlist", variant: "warning" };
    case "disabled_by_agent_tier":
      return { label: "Blocked by agent tier", variant: "warning" };
    case "disabled_by_execution_profile":
      return { label: "Blocked by execution profile", variant: "warning" };
    case "disabled_by_plugin_opt_in":
      return { label: "Blocked by plugin opt-in", variant: "warning" };
    case "disabled_by_plugin_policy":
      return { label: "Blocked by plugin policy", variant: "warning" };
    case "disabled_invalid_schema":
      return { label: "Blocked by invalid schema", variant: "warning" };
  }

  const unmatchedReason: never = tool.effective_exposure.reason;
  throw new Error(`Unknown tool exposure reason: ${unmatchedReason}`);
}

export function groupForTool(tool: ToolRegistryEntry): ToolGroupId {
  return tool.group ?? "unclassified";
}
