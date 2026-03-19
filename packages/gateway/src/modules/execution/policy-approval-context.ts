import { suggestedOverridesForToolCall } from "@tyrum/runtime-policy";

export function buildExecutionPolicyApprovalContext(input: {
  policySnapshotId: string;
  toolId: string;
  toolMatchTarget: string;
  decision: string;
  workspaceId?: string | null;
  agentId?: string | null;
  url?: string;
}): Record<string, unknown> {
  const policy: Record<string, unknown> = {
    policy_snapshot_id: input.policySnapshotId,
  };

  const agentId = input.agentId?.trim();
  if (agentId) {
    policy["agent_id"] = agentId;
  }

  const workspaceId = input.workspaceId?.trim();
  if (workspaceId) {
    policy["workspace_id"] = workspaceId;
  }

  const matchTarget = input.toolMatchTarget.trim();
  if (workspaceId && matchTarget) {
    const suggestedOverrides = suggestedOverridesForToolCall({
      toolId: input.toolId,
      matchTarget,
      workspaceId,
    });
    if (suggestedOverrides && suggestedOverrides.length > 0) {
      policy["suggested_overrides"] = suggestedOverrides;
    }
  }

  return {
    source: "execution-engine",
    policy_snapshot_id: input.policySnapshotId,
    tool_id: input.toolId,
    tool_match_target: input.toolMatchTarget,
    ...(input.url ? { url: input.url } : {}),
    decision: input.decision,
    policy,
  };
}
