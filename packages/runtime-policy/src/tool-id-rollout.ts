const MEMORY_TOOL_VERBS = new Set(["seed", "search", "write"]);
const LEGACY_MEMORY_PREFIX = "mcp.memory.";
const CANONICAL_MEMORY_PREFIX = "memory.";

function extractMemoryToolVerb(toolId: string): string | undefined {
  const normalized = toolId.trim();
  if (normalized.startsWith(LEGACY_MEMORY_PREFIX)) {
    const verb = normalized.slice(LEGACY_MEMORY_PREFIX.length);
    return MEMORY_TOOL_VERBS.has(verb) ? verb : undefined;
  }
  if (normalized.startsWith(CANONICAL_MEMORY_PREFIX)) {
    const verb = normalized.slice(CANONICAL_MEMORY_PREFIX.length);
    return MEMORY_TOOL_VERBS.has(verb) ? verb : undefined;
  }
  return undefined;
}

export function canonicalizeToolIdForRolloutMatching(toolId: string): string {
  const normalized = toolId.trim();
  const memoryVerb = extractMemoryToolVerb(normalized);
  return memoryVerb ? `${CANONICAL_MEMORY_PREFIX}${memoryVerb}` : normalized;
}

export function toolIdMatchCandidatesForRollout(toolId: string): string[] {
  const normalized = toolId.trim();
  if (normalized.length === 0) {
    return [];
  }

  const canonical = canonicalizeToolIdForRolloutMatching(normalized);
  if (!canonical.startsWith(CANONICAL_MEMORY_PREFIX)) {
    return [normalized];
  }

  const legacy = `${LEGACY_MEMORY_PREFIX}${canonical.slice(CANONICAL_MEMORY_PREFIX.length)}`;
  return normalized === canonical ? [canonical, legacy] : [normalized, canonical];
}

export function canonicalizeToolMatchTargetForRolloutMatching(matchTarget: string): string {
  return canonicalizeToolIdForRolloutMatching(matchTarget);
}

export function toolIdsMatchForRollout(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    canonicalizeToolIdForRolloutMatching(left) === canonicalizeToolIdForRolloutMatching(right)
  );
}

export function toolMatchTargetsMatchForRollout(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    canonicalizeToolMatchTargetForRolloutMatching(left) ===
      canonicalizeToolMatchTargetForRolloutMatching(right)
  );
}
