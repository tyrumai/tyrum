const LEGACY_TOOL_ID_MAP = new Map<string, string>([
  ["tool.fs.read", "read"],
  ["tool.fs.write", "write"],
  ["tool.exec", "bash"],
  ["tool.http.fetch", "webfetch"],
]);

const LEGACY_TOOL_ID_LIST_MAP = new Map<string, readonly string[]>([
  ["tool.*", ["*"]],
  ["tool.fs.*", ["read", "write", "edit", "apply_patch", "glob", "grep"]],
]);

function pushUnique(result: string[], seen: Set<string>, toolId: string): void {
  if (seen.has(toolId)) return;
  seen.add(toolId);
  result.push(toolId);
}

export function canonicalizeToolId(toolId: string): string {
  const normalized = toolId.trim();
  return LEGACY_TOOL_ID_MAP.get(normalized) ?? normalized;
}

export function canonicalizeToolIdList(toolIds: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawToolId of toolIds) {
    const normalized = rawToolId.trim();
    if (normalized.length === 0) continue;

    const expanded = LEGACY_TOOL_ID_LIST_MAP.get(normalized) ?? [canonicalizeToolId(normalized)];
    for (const toolId of expanded) {
      pushUnique(result, seen, toolId);
    }
  }

  return result;
}

export function normalizeStringIdList(toolIds: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawToolId of toolIds) {
    const normalized = rawToolId.trim();
    if (normalized.length === 0) continue;
    pushUnique(result, seen, normalized);
  }

  return result;
}

export function canonicalizeExactToolIdList(toolIds: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawToolId of toolIds) {
    const toolId = canonicalizeToolId(rawToolId);
    if (toolId.length === 0 || seen.has(toolId)) continue;
    seen.add(toolId);
    result.push(toolId);
  }

  return result;
}
