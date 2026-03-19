import type { Approval, ExecutionAttempt } from "@tyrum/client";
import { clientCapabilityFromDescriptorId } from "@tyrum/contracts";
import type { RunsState } from "@tyrum/operator-app";
import { parseAgentIdFromKey } from "../../lib/status-session-lanes.js";
import { isRecord } from "../../utils/is-record.js";

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatReviewRisk(review: Approval["latest_review"]): string | null {
  if (!review) return null;
  const parts = [
    review.risk_level ? review.risk_level.toUpperCase() : null,
    typeof review.risk_score === "number" ? `score ${String(review.risk_score)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type DesktopApprovalSummary = {
  op: string;
  actionKind?: string;
  targetText?: string;
};

export function describeDesktopApprovalContext(context: unknown): DesktopApprovalSummary | null {
  const ctx = isRecord(context) ? context : null;
  if (!ctx || ctx["source"] !== "agent-tool-execution" || ctx["tool_id"] !== "tool.node.dispatch") {
    return null;
  }

  const args = isRecord(ctx["args"]) ? (ctx["args"] as Record<string, unknown>) : null;
  if (!args) return null;
  const capability = typeof args["capability"] === "string" ? args["capability"].trim() : undefined;
  if (!capability || clientCapabilityFromDescriptorId(capability) !== "desktop") {
    return null;
  }
  const op = typeof args["action_name"] === "string" ? args["action_name"].trim() : "";
  if (!op) return null;

  const summary: DesktopApprovalSummary = { op };
  const actionArgs = isRecord(args["input"]) ? (args["input"] as Record<string, unknown>) : null;

  if (op === "act" && actionArgs) {
    const action = isRecord(actionArgs["action"])
      ? (actionArgs["action"] as Record<string, unknown>)
      : null;
    const kind = typeof action?.["kind"] === "string" ? action["kind"].trim() : "";
    if (kind) summary.actionKind = kind;

    const target = isRecord(actionArgs["target"])
      ? (actionArgs["target"] as Record<string, unknown>)
      : null;
    if (target) {
      const targetKind = typeof target["kind"] === "string" ? target["kind"].trim() : "";
      if (targetKind === "a11y") {
        const role = typeof target["role"] === "string" ? target["role"].trim() : "";
        const name = typeof target["name"] === "string" ? target["name"].trim() : "";
        const parts = [role ? `role=${role}` : undefined, name ? `name=${name}` : undefined].filter(
          (part): part is string => part !== undefined,
        );
        if (parts.length > 0) {
          summary.targetText = `target: a11y (${parts.join(" ")})`;
        } else {
          summary.targetText = "target: a11y";
        }
      } else if (targetKind) {
        summary.targetText = `target: ${targetKind}`;
      }
    }
  }

  return summary;
}

export type ApprovalArtifactsSummary = {
  runId: string;
  attemptId: string;
  artifacts: ExecutionAttempt["artifacts"];
};

export function resolveArtifactsForApprovalStep(
  runsState: RunsState,
  scope: { run_id?: string; step_id?: string; step_index?: number } | undefined,
): ApprovalArtifactsSummary | null {
  const runId = typeof scope?.run_id === "string" ? scope.run_id : "";
  const scopeStepId = typeof scope?.step_id === "string" ? scope.step_id : "";
  const stepIndex = typeof scope?.step_index === "number" ? scope.step_index : null;
  if (!runId) return null;

  const stepId =
    scopeStepId ||
    (stepIndex === null
      ? null
      : ((runsState.stepIdsByRunId[runId] ?? []).find((candidateId) => {
          const step = runsState.stepsById[candidateId];
          return step?.step_index === stepIndex;
        }) ?? null));
  if (!stepId) return null;

  let latestAttemptWithArtifacts: ExecutionAttempt | undefined;
  for (const attemptId of runsState.attemptIdsByStepId[stepId] ?? []) {
    const attempt = runsState.attemptsById[attemptId];
    if (!attempt || attempt.artifacts.length === 0) continue;
    if (!latestAttemptWithArtifacts || attempt.attempt > latestAttemptWithArtifacts.attempt) {
      latestAttemptWithArtifacts = attempt;
    }
  }

  if (!latestAttemptWithArtifacts) return null;

  return {
    runId,
    attemptId: latestAttemptWithArtifacts.attempt_id,
    artifacts: latestAttemptWithArtifacts.artifacts,
  };
}

export type ManagedAgentOption = {
  agentId: string;
  agentKey: string;
  label: string;
};

export type ApprovalAgentInfo = {
  filterValue: string;
  label: string;
};

export function formatAgentLabel(agent: ManagedAgentOption): string {
  return agent.label === agent.agentKey ? agent.agentKey : `${agent.label} (${agent.agentKey})`;
}

export function normalizeManagedAgentOptions(agents: unknown): ManagedAgentOption[] {
  if (!Array.isArray(agents)) {
    return [];
  }

  const optionsById = new Map<string, ManagedAgentOption>();
  for (const entry of agents) {
    if (!isRecord(entry)) continue;

    const agentId = typeof entry["agent_id"] === "string" ? entry["agent_id"].trim() : "";
    const agentKey = typeof entry["agent_key"] === "string" ? entry["agent_key"].trim() : "";
    const persona = isRecord(entry["persona"]) ? entry["persona"] : null;
    const displayName = typeof persona?.["name"] === "string" ? persona["name"].trim() : "";

    if (!agentId || !agentKey || optionsById.has(agentId)) {
      continue;
    }

    optionsById.set(agentId, {
      agentId,
      agentKey,
      label: displayName || agentKey,
    });
  }

  return [...optionsById.values()].toSorted((left, right) =>
    left.agentKey.localeCompare(right.agentKey),
  );
}

export function createManagedAgentLookup(
  agents: ManagedAgentOption[],
): Map<string, ManagedAgentOption> {
  const byIdentity = new Map<string, ManagedAgentOption>();
  for (const agent of agents) {
    byIdentity.set(agent.agentId, agent);
    byIdentity.set(agent.agentKey, agent);
  }
  return byIdentity;
}

function resolveApprovalAgentIdentity(approval: Approval): string | null {
  const agentId = approval.agent_id?.trim();
  if (agentId) {
    return agentId;
  }

  return typeof approval.scope?.key === "string" ? parseAgentIdFromKey(approval.scope.key) : null;
}

export function resolveApprovalAgentInfo(
  approval: Approval,
  managedAgentsByIdentity: Map<string, ManagedAgentOption>,
): ApprovalAgentInfo | null {
  const identity = resolveApprovalAgentIdentity(approval);
  if (!identity) {
    return null;
  }

  const managedAgent = managedAgentsByIdentity.get(identity);
  if (managedAgent) {
    return {
      filterValue: managedAgent.agentId,
      label: formatAgentLabel(managedAgent),
    };
  }

  return {
    filterValue: identity,
    label: identity,
  };
}

export function describeApprovalOutcome(status: Approval["status"]): string {
  switch (status) {
    case "approved":
      return "Resolved as approved.";
    case "denied":
      return "Resolved as denied.";
    case "expired":
      return "Expired before a decision was recorded.";
    case "cancelled":
      return "Cancelled before the action resumed.";
    default:
      return "Guardian review is in progress.";
  }
}
