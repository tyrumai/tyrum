import { canonicalizeToolId } from "./tool-id.js";

const CORE_TOOL_IDS = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "glob",
  "grep",
  "bash",
  "artifact.describe",
]);

const RETRIEVAL_TOOL_IDS = new Set(["websearch", "webfetch", "codesearch"]);
const RUNTIME_ONLY_TOOL_IDS = new Set(["guardian_review_decision"]);

const LEGACY_MEMORY_PREFIX = "mcp.memory.";
const CANONICAL_MEMORY_PREFIX = "memory.";

const LOCATION_PLACE_PREFIX = "tool.location.place.";
const AUTOMATION_SCHEDULE_PREFIX = "tool.automation.schedule.";
const SANDBOX_PREFIX = "sandbox.";
const SUBAGENT_PREFIX = "subagent.";
const WORKBOARD_PREFIX = "workboard.";
const MCP_PREFIX = "mcp.";
const PLUGIN_PREFIX = "plugin.";

export type ToolTaxonomySource = "builtin" | "builtin_mcp" | "mcp" | "plugin";
export type ToolTaxonomyLifecycle = "canonical" | "alias" | "deprecated";
export type ToolTaxonomyVisibility = "public" | "internal" | "runtime_only";
export type ToolTaxonomyGroup =
  | "core"
  | "retrieval"
  | "memory"
  | "environment"
  | "node"
  | "orchestration"
  | "extension";
export type ToolTaxonomyTier = "default" | "advanced";

export interface ToolTaxonomyMetadata {
  canonicalId: string;
  lifecycle: ToolTaxonomyLifecycle;
  visibility: ToolTaxonomyVisibility;
  family: string | null;
  group: ToolTaxonomyGroup | null;
  tier: ToolTaxonomyTier | null;
}

export interface ResolveToolTaxonomyInput {
  toolId: string;
  source?: ToolTaxonomySource;
  family?: string | null;
}

function normalizeOptionalFamily(family: string | null | undefined): string | null {
  if (typeof family !== "string") {
    return null;
  }
  const normalized = family.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeToolId(toolId: string): string {
  return toolId.trim();
}

function resolveCoreFamily(canonicalId: string): string {
  if (canonicalId === "bash") {
    return "shell";
  }
  if (canonicalId === "artifact.describe") {
    return "artifact";
  }
  return "filesystem";
}

function resolveNodeFamily(canonicalId: string): string {
  if (canonicalId.startsWith("tool.desktop.")) {
    return "tool.desktop";
  }
  if (canonicalId.startsWith("tool.browser.")) {
    return "tool.browser";
  }
  if (canonicalId.startsWith("tool.node.")) {
    return "tool.node";
  }
  if (canonicalId === "tool.location.get") {
    return "tool.location";
  }
  if (canonicalId.startsWith("tool.camera.")) {
    return "tool.camera";
  }
  if (canonicalId.startsWith("tool.audio.")) {
    return "tool.audio";
  }
  if (canonicalId === "tool.secret.copy-to-node-clipboard") {
    return "tool.secret";
  }
  return "node";
}

function isNodeCanonicalToolId(canonicalId: string): boolean {
  return (
    canonicalId.startsWith("tool.") &&
    !canonicalId.startsWith(LOCATION_PLACE_PREFIX) &&
    !canonicalId.startsWith(AUTOMATION_SCHEDULE_PREFIX)
  );
}

function isLegacyMemoryAlias(normalizedToolId: string, canonicalId: string): boolean {
  return (
    normalizedToolId.startsWith(LEGACY_MEMORY_PREFIX) &&
    canonicalId.startsWith(CANONICAL_MEMORY_PREFIX)
  );
}

function resolveLifecycle(normalizedToolId: string, canonicalId: string): ToolTaxonomyLifecycle {
  if (normalizedToolId === canonicalId) {
    return "canonical";
  }
  if (isLegacyMemoryAlias(normalizedToolId, canonicalId)) {
    return "deprecated";
  }
  return "alias";
}

function classifyCanonicalTool(input: {
  canonicalId: string;
  source?: ToolTaxonomySource;
  family: string | null;
}): Omit<ToolTaxonomyMetadata, "canonicalId" | "lifecycle"> {
  const { canonicalId, source, family } = input;

  if (RUNTIME_ONLY_TOOL_IDS.has(canonicalId)) {
    return {
      visibility: "runtime_only",
      family,
      group: null,
      tier: null,
    };
  }

  if (canonicalId.startsWith(CANONICAL_MEMORY_PREFIX)) {
    return {
      visibility: "public",
      family: "memory",
      group: "memory",
      tier: "default",
    };
  }

  if (CORE_TOOL_IDS.has(canonicalId)) {
    return {
      visibility: "public",
      family: resolveCoreFamily(canonicalId),
      group: "core",
      tier: "default",
    };
  }

  if (RETRIEVAL_TOOL_IDS.has(canonicalId)) {
    return {
      visibility: "public",
      family: family ?? "web",
      group: "retrieval",
      tier: "default",
    };
  }

  if (canonicalId.startsWith(LOCATION_PLACE_PREFIX)) {
    return {
      visibility: "public",
      family: "tool.location.place",
      group: "environment",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(AUTOMATION_SCHEDULE_PREFIX)) {
    return {
      visibility: "public",
      family: "tool.automation.schedule",
      group: "environment",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(SANDBOX_PREFIX)) {
    return {
      visibility: "public",
      family: "sandbox",
      group: "orchestration",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(SUBAGENT_PREFIX)) {
    return {
      visibility: "public",
      family: "subagent",
      group: "orchestration",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(WORKBOARD_PREFIX)) {
    return {
      visibility: "public",
      family: "workboard",
      group: "orchestration",
      tier: "advanced",
    };
  }

  if (isNodeCanonicalToolId(canonicalId)) {
    return {
      visibility: "public",
      family: resolveNodeFamily(canonicalId),
      group: "node",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(MCP_PREFIX) || source === "mcp") {
    return {
      visibility: "public",
      family: family ?? "mcp",
      group: "extension",
      tier: "advanced",
    };
  }

  if (canonicalId.startsWith(PLUGIN_PREFIX) || source === "plugin") {
    return {
      visibility: "public",
      family: family ?? "plugin",
      group: "extension",
      tier: "advanced",
    };
  }

  if (source === "builtin_mcp") {
    return {
      visibility: "public",
      family,
      group: "extension",
      tier: "advanced",
    };
  }

  return {
    visibility: "internal",
    family,
    group: null,
    tier: null,
  };
}

export function resolveToolTaxonomyMetadata(input: ResolveToolTaxonomyInput): ToolTaxonomyMetadata {
  const normalizedToolId = normalizeToolId(input.toolId);
  const canonicalId = canonicalizeToolId(normalizedToolId);
  const lifecycle = resolveLifecycle(normalizedToolId, canonicalId);
  const canonicalClassification = classifyCanonicalTool({
    canonicalId,
    source: input.source,
    family: normalizeOptionalFamily(input.family),
  });

  if (lifecycle === "alias") {
    return {
      canonicalId,
      lifecycle,
      visibility: "runtime_only",
      family: canonicalClassification.family,
      group: canonicalClassification.group,
      tier: canonicalClassification.tier,
    };
  }

  return {
    canonicalId,
    lifecycle,
    visibility: canonicalClassification.visibility,
    family: canonicalClassification.family,
    group: canonicalClassification.group,
    tier: canonicalClassification.tier,
  };
}
