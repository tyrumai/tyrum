import {
  type Approval,
  isApprovalHumanActionableStatus,
  type OperatorCore,
  type ResolveApprovalInput,
} from "@tyrum/operator-app";
import { CircleCheck } from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AttemptArtifactsDialog } from "../artifacts/attempt-artifacts-dialog.js";
import { AppPage } from "../layout/app-page.js";
import { ApprovalActions } from "./approval-actions.js";
import {
  createManagedAgentLookup,
  describeApprovalOutcome,
  describeDesktopApprovalContext,
  formatAgentLabel,
  formatReviewRisk,
  formatTimestamp,
  normalizeManagedAgentOptions,
  resolveApprovalAgentInfo,
  resolveArtifactsForApprovalStep,
  type ManagedAgentOption,
} from "./approvals-page.helpers.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LiveRegion } from "../ui/live-region.js";
import { LoadingState } from "../ui/loading-state.js";
import { Select } from "../ui/select.js";

import { useOperatorStore } from "../../use-operator-store.js";
import { useI18n } from "../../i18n-helpers.js";
import { isAdminAccessRequiredError } from "../elevated-mode/admin-access-error.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  ManagedDesktopTakeoverDialog,
  useManagedDesktopTakeover,
} from "./managed-desktop-takeover.js";

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

export function ApprovalsPage({ core }: { core: OperatorCore }) {
  const intl = useI18n();
  const approvals = useOperatorStore(core.approvalsStore);
  const runsState = useOperatorStore(core.turnsStore);
  const adminHttp = useAdminMutationHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const blockedApprovalIds = approvals.blockedIds ?? approvals.pendingIds;
  const historyApprovalIds = approvals.historyIds ?? [];
  const [resolvingById, setResolvingById] = useState<
    Record<string, "approved" | "denied" | "always" | undefined>
  >({});
  const [managedAgents, setManagedAgents] = useState<ManagedAgentOption[]>([]);
  const [agentFilter, setAgentFilter] = useState("all");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [approvalsErrorDismissed, setApprovalsErrorDismissed] = useState(false);
  const takeover = useManagedDesktopTakeover({
    getAdminHttp: () => adminHttp,
    requestEnter,
  });

  useEffect(() => {
    setApprovalsErrorDismissed(false);
  }, [approvals.error]);

  useEffect(() => {
    let cancelled = false;
    const listAgents = core.admin?.agents?.list;

    if (typeof listAgents !== "function") {
      setManagedAgents([]);
      return;
    }

    const loadAgents = async (): Promise<void> => {
      try {
        const response = await listAgents();
        if (cancelled) return;
        setManagedAgents(normalizeManagedAgentOptions((response as { agents?: unknown }).agents));
      } catch {
        if (!cancelled) {
          setManagedAgents([]);
        }
      }
    };

    void loadAgents();

    return () => {
      cancelled = true;
    };
  }, [core.admin]);

  const managedAgentsByIdentity = useMemo(
    () => createManagedAgentLookup(managedAgents),
    [managedAgents],
  );

  const agentFilterOptions = useMemo(() => {
    const optionsByValue = new Map<string, string>();
    for (const agent of managedAgents) {
      optionsByValue.set(agent.agentId, formatAgentLabel(agent));
    }

    for (const approval of Object.values(approvals.byId)) {
      const agentInfo = resolveApprovalAgentInfo(approval, managedAgentsByIdentity);
      if (!agentInfo || optionsByValue.has(agentInfo.filterValue)) {
        continue;
      }
      optionsByValue.set(agentInfo.filterValue, agentInfo.label);
    }

    return [...optionsByValue.entries()]
      .map(([value, label]) => ({ value, label }))
      .toSorted((left, right) => left.label.localeCompare(right.label));
  }, [approvals.byId, managedAgents, managedAgentsByIdentity]);

  useEffect(() => {
    if (agentFilter === "all") return;
    if (agentFilterOptions.some((option) => option.value === agentFilter)) return;
    setAgentFilter("all");
  }, [agentFilter, agentFilterOptions]);

  const matchesAgentFilter = (approval: Approval | undefined): boolean => {
    if (!approval) return false;
    if (agentFilter === "all") return true;
    const agentInfo = resolveApprovalAgentInfo(approval, managedAgentsByIdentity);
    return agentInfo?.filterValue === agentFilter;
  };

  const filteredBlockedApprovalIds = useMemo(
    () => blockedApprovalIds.filter((approvalId) => matchesAgentFilter(approvals.byId[approvalId])),
    [agentFilter, approvals.byId, blockedApprovalIds, managedAgentsByIdentity],
  );
  const filteredHistoryApprovalIds = useMemo(
    () => historyApprovalIds.filter((approvalId) => matchesAgentFilter(approvals.byId[approvalId])),
    [agentFilter, approvals.byId, historyApprovalIds, managedAgentsByIdentity],
  );
  const approvalsLoadingInitially =
    approvals.loading &&
    approvals.lastSyncedAt === null &&
    blockedApprovalIds.length === 0 &&
    historyApprovalIds.length === 0;
  const agentFilterActive = agentFilter !== "all";

  const resolveApproval = async (input: ResolveApprovalInput): Promise<void> => {
    if (resolvingById[input.approvalId]) return;
    if (!canMutate) {
      requestEnter();
      return;
    }

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
      if (isAdminAccessRequiredError(error)) {
        requestEnter();
        return;
      }
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingById((prev) => {
        const next = { ...prev };
        delete next[input.approvalId];
        return next;
      });
    }
  };

  const renderApprovalCards = (approvalIds: string[]) => (
    <div className="grid gap-3">
      {approvalIds.map((approvalId) => {
        const approval = approvals.byId[approvalId];
        if (!approval) return null;

        const resolvingDecision = resolvingById[approvalId];
        const actionable = isApprovalHumanActionableStatus(approval.status);
        const statusDisplay = getApprovalStatusDisplay(approval.status);
        const reviewReason = approval.latest_review?.reason?.trim() ?? "";
        const reviewRisk = formatReviewRisk(intl, approval.latest_review);
        const scope = approval.scope;
        const approvalAgent = resolveApprovalAgentInfo(approval, managedAgentsByIdentity);
        const detailEntries = [
          ["Approval key", approval.approval_key],
          ["Conversation", scope?.conversation_key],
          ["Turn", scope?.turn_id],
          ["Step", scope?.step_id],
          ["Attempt", scope?.attempt_id],
        ].filter((entry): entry is [string, string] => typeof entry[1] === "string");

        const desktop = describeDesktopApprovalContext(approval.context);
        const hasMotivation = Boolean(approval.motivation);
        const hasReview = Boolean(reviewReason || reviewRisk);
        const hasDesktop = desktop !== null;
        const hasDetails = detailEntries.length > 0;
        const hasContext = hasMotivation || hasReview || hasDesktop || hasDetails;
        const isExpanded = expandedCards[approvalId] === true;

        return (
          <Card key={approvalId}>
            <CardHeader className="pb-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{approval.kind}</Badge>
                  <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                  {approvalAgent ? (
                    <span className="text-xs text-fg-muted">{approvalAgent.label}</span>
                  ) : null}
                </div>
                <time
                  dateTime={approval.created_at}
                  className="text-xs text-fg-muted"
                  title={approval.created_at}
                >
                  {formatTimestamp(intl, approval.created_at)}
                </time>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <blockquote className="rounded-md border border-border bg-bg-subtle px-3 py-2.5 text-sm text-fg break-words [overflow-wrap:anywhere]">
                {approval.prompt}
              </blockquote>

              <div className="flex items-center gap-3 pt-2">
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
                    {describeApprovalOutcome(intl, approval.status)}
                  </div>
                )}
              </div>

              {hasContext ? (
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:text-fg transition-colors text-left w-fit"
                  onClick={() =>
                    setExpandedCards((prev) => ({
                      ...prev,
                      [approvalId]: !prev[approvalId],
                    }))
                  }
                >
                  {isExpanded ? "Hide context" : "Show context"}
                </button>
              ) : null}

              {isExpanded ? (
                <>
                  {hasMotivation ? (
                    <div
                      data-testid={`approval-motivation-${approvalId}`}
                      className="grid gap-0.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                    >
                      <div className="text-xs font-medium text-fg-muted">Motivation</div>
                      <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
                        {approval.motivation}
                      </div>
                    </div>
                  ) : null}

                  {hasReview ? (
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

                  {hasDetails ? (
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

                  {hasDesktop
                    ? (() => {
                        const artifacts = resolveArtifactsForApprovalStep(
                          runsState,
                          approval.scope,
                        );
                        const managedDesktop = approval.managed_desktop;

                        return (
                          <div
                            data-testid={`desktop-approval-summary-${approvalId}`}
                            className="grid gap-1.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                              <Badge variant="outline">Desktop</Badge>
                              <span className="font-medium text-fg">{desktop.op}</span>
                              {desktop.actionKind ? (
                                <span className="text-fg-muted">&bull; {desktop.actionKind}</span>
                              ) : null}
                            </div>
                            {desktop.targetText ? (
                              <div className="text-xs text-fg-muted">{desktop.targetText}</div>
                            ) : null}
                            {artifacts ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <AttemptArtifactsDialog
                                  core={core}
                                  attemptId={artifacts.attemptId}
                                  artifacts={artifacts.artifacts}
                                />
                              </div>
                            ) : null}
                            {managedDesktop ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-fit"
                                data-testid={`approval-takeover-${approvalId}`}
                                onClick={() => {
                                  void takeover
                                    .open({
                                      environmentId: managedDesktop.environment_id,
                                      title: desktop.targetText ?? approval.prompt,
                                    })
                                    .catch((error) => toast.error(formatErrorMessage(error)));
                                }}
                              >
                                Open takeover
                              </Button>
                            ) : null}
                          </div>
                        );
                      })()
                    : null}
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  return (
    <>
      <AppPage contentClassName="max-w-4xl gap-5">
        <LiveRegion data-testid="approvals-pending-live">
          {approvals.pendingIds.length} approvals awaiting action
        </LiveRegion>

        {approvals.error && !approvalsErrorDismissed ? (
          <Alert
            variant="error"
            title="Approvals failed to load"
            description={approvals.error}
            onDismiss={() => setApprovalsErrorDismissed(true)}
          />
        ) : null}

        <Card data-testid="approvals-filters">
          <CardHeader className="pb-3">
            <div className="text-sm font-medium text-fg">Filters</div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[minmax(0,16rem)_auto] md:items-end">
            <Select
              label="Agent"
              data-testid="approvals-agent-filter"
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.currentTarget.value)}
            >
              <option value="all">All agents</option>
              {agentFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Badge>{`${filteredBlockedApprovalIds.length} awaiting attention`}</Badge>
              <Badge variant="outline">{`${filteredHistoryApprovalIds.length} in history`}</Badge>
            </div>
          </CardContent>
        </Card>

        {approvalsLoadingInitially ? (
          <LoadingState variant="centered" label="Loading approvals…" />
        ) : (
          <>
            <section data-testid="approvals-needs-attention" className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-fg">Needs attention</h2>
                <Badge variant="outline">{filteredBlockedApprovalIds.length}</Badge>
              </div>
              {filteredBlockedApprovalIds.length > 0 ? (
                renderApprovalCards(filteredBlockedApprovalIds)
              ) : (
                <EmptyState
                  icon={CircleCheck}
                  title={
                    agentFilterActive
                      ? "No pending approvals for this agent"
                      : "No pending approvals"
                  }
                  description={
                    agentFilterActive
                      ? "Try a different agent filter to review approvals for another agent."
                      : "Approvals appear here when agents request permission to perform actions."
                  }
                />
              )}
            </section>

            <section data-testid="approvals-history" className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-fg">History</h2>
                <Badge variant="outline">{filteredHistoryApprovalIds.length}</Badge>
              </div>
              {filteredHistoryApprovalIds.length > 0 ? (
                renderApprovalCards(filteredHistoryApprovalIds)
              ) : (
                <EmptyState
                  icon={CircleCheck}
                  title={
                    agentFilterActive
                      ? "No approval history for this agent"
                      : "No approval history yet"
                  }
                  description={
                    agentFilterActive
                      ? "Resolved approvals for the selected agent will appear here."
                      : "Resolved approvals will appear here once agents start requesting access."
                  }
                />
              )}
            </section>
          </>
        )}
      </AppPage>
      <ManagedDesktopTakeoverDialog conversation={takeover.conversation} onClose={takeover.close} />
    </>
  );
}
