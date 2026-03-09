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
      if (seen.has(toolId)) continue;
      seen.add(toolId);
      result.push(toolId);
    }
  }

  return result;
}
