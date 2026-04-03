import type { Approval, ExecutionAttempt, TurnsState } from "@tyrum/operator-app";
import type { IntlShape } from "react-intl";
import { formatDateTimeString, translateString } from "../../i18n-helpers.js";
import { parseAgentKeyFromConversationKey } from "../../lib/conversation-turn-activity.js";
import { isRecord } from "../../utils/is-record.js";

export function formatTimestamp(intl: IntlShape, value: string): string {
  return formatDateTimeString(intl, value);
}

export function formatReviewRisk(
  intl: IntlShape,
  review: Approval["latest_review"],
): string | null {
  if (!review) return null;
  const parts = [
    review.risk_level ? review.risk_level.toUpperCase() : null,
    typeof review.risk_score === "number"
      ? translateString(intl, "score {score}", { score: review.risk_score })
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type DesktopApprovalSummary = {
  op: string;
  actionKind?: string;
  targetText?: string;
};

export function isApprovalAutoExpandStatus(status: Approval["status"] | "pending"): boolean {
  return status === "awaiting_human" || status === "pending";
}

export function pickDefaultExpandedApprovalId(
  approvalIds: string[],
  byId: Record<string, Approval>,
): string | null {
  for (const approvalId of approvalIds) {
    const approval = byId[approvalId];
    if (approval && isApprovalAutoExpandStatus(approval.status)) {
      return approvalId;
    }
  }
  return null;
}

export function describeDesktopApprovalContext(context: unknown): DesktopApprovalSummary | null {
  const ctx = isRecord(context) ? context : null;
  if (!ctx || ctx["source"] !== "agent-tool-execution") {
    return null;
  }

  const toolId = typeof ctx["tool_id"] === "string" ? ctx["tool_id"].trim() : "";
  if (!toolId.startsWith("tool.desktop.")) {
    return null;
  }
  const op = toolId.slice("tool.desktop.".length).trim();
  if (!op) return null;

  const summary: DesktopApprovalSummary = { op };
  const actionArgs = isRecord(ctx["args"]) ? (ctx["args"] as Record<string, unknown>) : null;

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

export function describeApprovalTableContext(approval: Approval): string | null {
  const desktop = describeDesktopApprovalContext(approval.context);
  if (desktop) {
    const desktopParts = ["Desktop", desktop.op, desktop.actionKind, desktop.targetText].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return desktopParts.join(" · ");
  }

  const scope = approval.scope;
  if (!scope) return null;

  const scopeParts = [
    scope.conversation_key ? `Conversation ${scope.conversation_key}` : null,
    scope.turn_id ? `Turn ${scope.turn_id}` : null,
    scope.turn_item_id ? `Turn item ${scope.turn_item_id}` : null,
    scope.workflow_run_step_id ? `Workflow step ${scope.workflow_run_step_id}` : null,
  ].filter((part): part is string => part !== null);

  return scopeParts.length > 0 ? scopeParts.join(" · ") : null;
}

export type ApprovalArtifactsSummary = {
  turnId: string;
  attemptId: string;
  artifacts: ExecutionAttempt["artifacts"];
};

function extractLegacyExecutionScope(context: unknown): {
  stepId: string;
  stepIndex: number | null;
} {
  const ctx = isRecord(context) ? context : null;
  const stepId = typeof ctx?.["step_id"] === "string" ? ctx["step_id"] : "";
  const stepIndex = typeof ctx?.["step_index"] === "number" ? ctx["step_index"] : null;
  return { stepId, stepIndex };
}

export function resolveArtifactsForApprovalStep(
  runsState: TurnsState,
  input: {
    scope:
      | {
          turn_id?: string;
          workflow_run_step_id?: string;
        }
      | undefined;
    context: unknown;
  },
): ApprovalArtifactsSummary | null {
  const turnId = typeof input.scope?.turn_id === "string" ? input.scope.turn_id : "";
  const workflowRunStepId =
    typeof input.scope?.workflow_run_step_id === "string" ? input.scope.workflow_run_step_id : "";
  const legacy = extractLegacyExecutionScope(input.context);
  const stepIndex = legacy.stepIndex;
  if (!turnId) return null;

  const stepId =
    legacy.stepId ||
    (workflowRunStepId && runsState.stepsById[workflowRunStepId] ? workflowRunStepId : "") ||
    (stepIndex === null
      ? null
      : ((runsState.stepIdsByTurnId[turnId] ?? []).find((candidateId) => {
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
    turnId,
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

  return typeof approval.scope?.conversation_key === "string"
    ? parseAgentKeyFromConversationKey(approval.scope.conversation_key)
    : null;
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

export function describeApprovalOutcome(intl: IntlShape, status: Approval["status"]): string {
  switch (status) {
    case "approved":
      return translateString(intl, "Resolved as approved.");
    case "denied":
      return translateString(intl, "Resolved as denied.");
    case "expired":
      return translateString(intl, "Expired before a decision was recorded.");
    case "cancelled":
      return translateString(intl, "Cancelled before the action resumed.");
    default:
      return translateString(intl, "Guardian review is in progress.");
  }
}
