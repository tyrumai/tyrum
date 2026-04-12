import { canonicalizeToolMatchTargetForRolloutMatching } from "./tool-id-rollout.js";
import { isSafeSuggestedOverridePattern } from "./override-guardrails.js";

export type SuggestedOverride = { tool_id: string; pattern: string; workspace_id: string };

export function suggestedOverridesForToolCall(input: {
  toolId: string;
  matchTarget: string;
  workspaceId: string;
}): SuggestedOverride[] | undefined {
  const trimmed = canonicalizeToolMatchTargetForRolloutMatching(input.matchTarget);
  if (trimmed.length === 0) return undefined;
  if (input.toolId === "tool.automation.schedule.create" && trimmed.includes("execution:steps")) {
    return undefined;
  }

  const patterns: string[] = [];

  if (isSafeSuggestedOverridePattern(trimmed)) {
    patterns.push(trimmed);
  }

  if (patterns.length === 0) return undefined;
  return patterns.map((pattern) => ({
    tool_id: input.toolId,
    pattern,
    workspace_id: input.workspaceId,
  }));
}
