import type { ExecutionAttempt } from "@tyrum/client";
import type { OperatorCore, RunsState } from "@tyrum/operator-core";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AttemptArtifactsDialog } from "../artifacts/attempt-artifacts-dialog.js";
import { PageHeader } from "../layout/page-header.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LiveRegion } from "../ui/live-region.js";
import { Spinner } from "../ui/spinner.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { extractTakeoverUrlFromNodeIdentity } from "../../utils/takeover-url.js";
import { isRecord } from "../../utils/is-record.js";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  if (args["capability"] !== "tyrum.desktop") return null;
  if (args["action"] !== "Desktop") return null;

  const actionArgs = isRecord(args["args"]) ? (args["args"] as Record<string, unknown>) : null;
  if (!actionArgs) return null;

  const op = typeof actionArgs["op"] === "string" ? actionArgs["op"].trim() : "";
  if (!op) return null;

  const summary: DesktopApprovalSummary = { op };

  if (op === "act") {
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
  scope: { run_id?: string; step_index?: number } | undefined,
): ApprovalArtifactsSummary | null {
  const runId = typeof scope?.run_id === "string" ? scope.run_id : "";
  const stepIndex = typeof scope?.step_index === "number" ? scope.step_index : null;
  if (!runId || stepIndex === null) return null;

  const stepId = (runsState.stepIdsByRunId[runId] ?? []).find((candidateId) => {
    const step = runsState.stepsById[candidateId];
    return step?.step_index === stepIndex;
  });
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
  const [resolvingById, setResolvingById] = useState<
    Record<string, "approved" | "denied" | undefined>
  >({});

  const desktopTakeoverLinks = Object.values(pairingState.byId)
    .filter((pairing) => pairing.status === "approved")
    .map((pairing) => {
      const capabilities = pairing.node.capabilities;
      if (!capabilities.includes("desktop")) return null;
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

  const resolveApproval = async (
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<void> => {
    if (resolvingById[approvalId]) return;

    setResolvingById((prev) => ({ ...prev, [approvalId]: decision }));
    try {
      await core.approvalsStore.resolve(approvalId, decision);
      toast.success(decision === "approved" ? "Approval resolved" : "Approval denied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingById((prev) => {
        const next = { ...prev };
        delete next[approvalId];
        return next;
      });
    }
  };

  return (
    <div className="grid gap-5">
      <PageHeader title="Approvals" />

      <LiveRegion data-testid="approvals-pending-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      {approvals.error ? (
        <Alert variant="error" title="Approvals failed to load" description={approvals.error} />
      ) : null}

      {approvals.pendingIds.length === 0 ? (
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
          {approvals.pendingIds.map((approvalId) => {
            const approval = approvals.byId[approvalId];
            if (!approval) return null;

            const resolvingDecision = resolvingById[approvalId];
            const isResolving = resolvingDecision !== undefined;

            return (
              <Card key={approvalId}>
                <CardHeader className="pb-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="outline">{approval.kind}</Badge>
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
                  <Button
                    data-testid={`approval-approve-${approvalId}`}
                    variant="success"
                    disabled={isResolving}
                    isLoading={resolvingDecision === "approved"}
                    onClick={() => {
                      void resolveApproval(approvalId, "approved");
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    data-testid={`approval-deny-${approvalId}`}
                    variant="danger"
                    disabled={isResolving}
                    isLoading={resolvingDecision === "denied"}
                    onClick={() => {
                      void resolveApproval(approvalId, "denied");
                    }}
                  >
                    Deny
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
