import { isSafeSuggestedOverridePattern } from "./override-guardrails.js";

export type SuggestedOverride = { tool_id: string; pattern: string; workspace_id: string };

function deriveDesktopActPrefixPattern(matchTarget: string): string | undefined {
  const marker = ";op:act";
  const index = matchTarget.indexOf(marker);
  if (index === -1) return undefined;

  const base = matchTarget.slice(0, index + marker.length);
  return `${base}*`;
}

export function suggestedOverridesForToolCall(input: {
  toolId: string;
  matchTarget: string;
  workspaceId: string;
}): SuggestedOverride[] | undefined {
  const trimmed = input.matchTarget.trim();
  if (trimmed.length === 0) return undefined;

  const patterns: string[] = [];

  if (isSafeSuggestedOverridePattern(trimmed)) {
    patterns.push(trimmed);
  }

  if (input.toolId === "tool.node.dispatch") {
    const desktopActPrefix = deriveDesktopActPrefixPattern(trimmed);
    if (
      desktopActPrefix &&
      desktopActPrefix !== trimmed &&
      isSafeSuggestedOverridePattern(desktopActPrefix) &&
      !patterns.includes(desktopActPrefix)
    ) {
      patterns.push(desktopActPrefix);
    }
  }

  if (patterns.length === 0) return undefined;
  return patterns.map((pattern) => ({
    tool_id: input.toolId,
    pattern,
    workspace_id: input.workspaceId,
  }));
}

