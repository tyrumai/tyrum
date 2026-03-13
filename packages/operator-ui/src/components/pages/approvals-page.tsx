import type { Approval, ExecutionAttempt } from "@tyrum/client";
import {
  isApprovalHumanActionableStatus,
  type OperatorCore,
  type ResolveApprovalInput,
  type RunsState,
} from "@tyrum/operator-core";
import { clientCapabilityFromDescriptorId, type CapabilityDescriptor } from "@tyrum/schemas";
import { CircleCheck } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { AttemptArtifactsDialog } from "../artifacts/attempt-artifacts-dialog.js";
import { AppPage } from "../layout/app-page.js";
import { ApprovalActions } from "./approval-actions.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LiveRegion } from "../ui/live-region.js";
import { Spinner } from "../ui/spinner.js";
import { parseAgentIdFromKey } from "../../lib/status-session-lanes.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { extractTakeoverUrlFromNodeIdentity } from "../../utils/takeover-url.js";
import { isRecord } from "../../utils/is-record.js";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatReviewRisk(review: Approval["latest_review"]): string | null {
  if (!review) return null;
  const parts = [
    review.risk_level ? review.risk_level.toUpperCase() : null,
    typeof review.risk_score === "number" ? `score ${String(review.risk_score)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function getApprovalStatusDisplay(status: Approval["status"] | "pending"): {
  label: string;
  variant: ComponentProps<typeof Badge>["variant"];
} {
  switch (status) {
    case "pending":
      return { label: "Awaiting human review", variant: "warning" };
    case "queued":
      return { label: "Guardian queued", variant: "outline" };
    case "reviewing":
      return { label: "Guardian reviewing", variant: "outline" };
    case "awaiting_human":
      return { label: "Awaiting human review", variant: "warning" };
    case "approved":
      return { label: "Approved", variant: "success" };
    case "denied":
    case "expired":
    case "cancelled":
      return { label: status, variant: "danger" };
  }
}

type DesktopApprovalSummary = {
  op: string;
  actionKind?: string;
  targetText?: string;
};

function describeDesktopApprovalContext(context: unknown): DesktopApprovalSummary | null {
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

type ApprovalArtifactsSummary = {
  runId: string;
  attemptId: string;
  artifacts: ExecutionAttempt["artifacts"];
};

function resolveArtifactsForApprovalStep(
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

export function ApprovalsPage({ core }: { core: OperatorCore }) {
  const approvals = useOperatorStore(core.approvalsStore);
  const pairingState = useOperatorStore(core.pairingStore);
  const runsState = useOperatorStore(core.runsStore);
  const blockedApprovalIds = approvals.blockedIds ?? approvals.pendingIds;
  const [resolvingById, setResolvingById] = useState<
    Record<string, "approved" | "denied" | "always" | undefined>
  >({});

  const desktopTakeoverLinks = Object.values(pairingState.byId)
    .filter((pairing) => pairing.status === "approved")
    .map((pairing) => {
      const capabilities = pairing.node.capabilities;
      if (
        !capabilities.some(
          (capability: CapabilityDescriptor) =>
            clientCapabilityFromDescriptorId(capability.id) === "desktop",
        )
      ) {
        return null;
      }
      const url = extractTakeoverUrlFromNodeIdentity(pairing.node);
      if (!url) return null;
      return {
        nodeId: pairing.node.node_id,
        label: pairing.node.label,
        url,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));

  const takeoverUrl = desktopTakeoverLinks.at(0)?.url;

  const resolveApproval = async (input: ResolveApprovalInput): Promise<void> => {
    if (resolvingById[input.approvalId]) return;

    setResolvingById((prev) => ({
      ...prev,
      [input.approvalId]: input.mode === "always" ? "always" : input.decision,
    }));
    try {
      await core.approvalsStore.resolve(input);
      toast.success(
        input.decision === "denied"
          ? "Approval denied"
          : input.mode === "always"
            ? "Always approve enabled"
            : "Approval resolved",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingById((prev) => {
        const next = { ...prev };
        delete next[input.approvalId];
        return next;
      });
    }
  };

  return (
    <AppPage contentClassName="max-w-4xl gap-5">
      <LiveRegion data-testid="approvals-pending-live">
        {approvals.pendingIds.length} approvals awaiting action
      </LiveRegion>

      {approvals.error ? (
        <Alert variant="error" title="Approvals failed to load" description={approvals.error} />
      ) : null}

      {blockedApprovalIds.length === 0 ? (
        approvals.loading && approvals.lastSyncedAt === null ? (
          <div
            className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-fg-muted"
            aria-busy={true}
          >
            <Spinner aria-hidden={true} />
            Loading approvals...
          </div>
        ) : (
          <EmptyState
            icon={CircleCheck}
            title="No pending approvals"
            description="Approvals appear here when agents request permission to perform actions."
          />
        )
      ) : (
        <div className="grid gap-3">
          {blockedApprovalIds.map((approvalId) => {
            const approval = approvals.byId[approvalId];
            if (!approval) return null;

            const resolvingDecision = resolvingById[approvalId];
            const actionable = isApprovalHumanActionableStatus(approval.status);
            const statusDisplay = getApprovalStatusDisplay(approval.status);
            const reviewReason = approval.latest_review?.reason?.trim() ?? "";
            const reviewRisk = formatReviewRisk(approval.latest_review);
            const scope = approval.scope;
            const approvalAgentKey =
              typeof scope?.key === "string" ? parseAgentIdFromKey(scope.key) : null;
            const detailEntries = [
              ["Approval key", approval.approval_key],
              ["Agent", approvalAgentKey ?? undefined],
              ["Scope key", scope?.key],
              ["Lane", scope?.lane],
              ["Run", scope?.run_id],
              ["Step", scope?.step_id],
              ["Attempt", scope?.attempt_id],
            ].filter((entry): entry is [string, string] => typeof entry[1] === "string");

            return (
              <Card key={approvalId}>
                <CardHeader className="pb-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{approval.kind}</Badge>
                      <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                    </div>
                    <time
                      dateTime={approval.created_at}
                      className="text-xs text-fg-muted"
                      title={approval.created_at}
                    >
                      {formatTimestamp(approval.created_at)}
                    </time>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <blockquote className="rounded-md border border-border bg-bg-subtle px-3 py-2.5 text-sm text-fg break-words [overflow-wrap:anywhere]">
                    {approval.prompt}
                  </blockquote>

                  <div
                    data-testid={`approval-motivation-${approvalId}`}
                    className="grid gap-0.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                  >
                    <div className="text-xs font-medium text-fg-muted">Motivation</div>
                    <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
                      {approval.motivation}
                    </div>
                  </div>

                  {reviewReason || reviewRisk ? (
                    <div
                      data-testid={`approval-review-${approvalId}`}
                      className="grid gap-1 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                    >
                      <div className="text-xs font-medium text-fg-muted">Latest review</div>
                      {reviewReason ? (
                        <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
                          {reviewReason}
                        </div>
                      ) : null}
                      {reviewRisk ? (
                        <div className="text-xs text-fg-muted">Risk {reviewRisk}</div>
                      ) : null}
                    </div>
                  ) : null}

                  {detailEntries.length > 0 ? (
                    <div
                      data-testid={`approval-details-${approvalId}`}
                      className="grid gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                    >
                      {detailEntries.map(([label, value]) => (
                        <div key={label} className="grid gap-0.5">
                          <div className="text-xs font-medium text-fg-muted">{label}</div>
                          <div className="font-mono text-xs text-fg break-all">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {(() => {
                    const desktop = describeDesktopApprovalContext(approval.context);
                    if (!desktop) return null;

                    const artifacts = resolveArtifactsForApprovalStep(runsState, approval.scope);

                    return (
                      <div
                        data-testid={`desktop-approval-summary-${approvalId}`}
                        className="grid gap-1.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                          <Badge variant="outline">Desktop</Badge>
                          <span className="font-medium text-fg">{desktop.op}</span>
                          {desktop.actionKind ? (
                            <span className="text-fg-muted">• {desktop.actionKind}</span>
                          ) : null}
                        </div>
                        {desktop.targetText ? (
                          <div className="text-xs text-fg-muted">{desktop.targetText}</div>
                        ) : null}
                        {artifacts ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <AttemptArtifactsDialog
                              core={core}
                              runId={artifacts.runId}
                              attemptId={artifacts.attemptId}
                              artifacts={artifacts.artifacts}
                            />
                          </div>
                        ) : null}
                        {takeoverUrl ? (
                          <Button asChild size="sm" variant="outline" className="w-fit">
                            <a
                              data-testid={`approval-takeover-${approvalId}`}
                              href={takeoverUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Open takeover
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    );
                  })()}
                </CardContent>
                <CardFooter className="gap-2">
                  {actionable ? (
                    <ApprovalActions
                      approvalId={approvalId}
                      approval={approval}
                      resolvingState={resolvingDecision}
                      onResolve={(input) => {
                        void resolveApproval(input);
                      }}
                    />
                  ) : (
                    <div className="text-sm text-fg-muted">
                      {approval.status === "queued"
                        ? "Queued for guardian review."
                        : "Guardian review is in progress."}
                    </div>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </AppPage>
  );
}
