import { type Approval, type OperatorCore, type ResolveApprovalInput } from "@tyrum/operator-app";
import { CircleCheck } from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppPage } from "../layout/app-page.js";
import { ApprovalExpandedRow } from "./approvals-page.expanded-row.js";
import {
  createManagedAgentLookup,
  describeApprovalTableContext,
  formatAgentLabel,
  formatTimestamp,
  isApprovalAutoExpandStatus,
  normalizeManagedAgentOptions,
  pickDefaultExpandedApprovalId,
  resolveApprovalAgentInfo,
  type ManagedAgentOption,
} from "./approvals-page.helpers.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { EmptyState } from "../ui/empty-state.js";
import { LiveRegion } from "../ui/live-region.js";
import { LoadingState } from "../ui/loading-state.js";
import { Select } from "../ui/select.js";

import { useOperatorStore } from "../../use-operator-store.js";
import { useI18n } from "../../i18n-helpers.js";
import { isAdminAccessRequiredError } from "../elevated-mode/admin-access-error.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
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

type ApprovalTableRow = {
  approvalId: string;
  approval: Approval;
  agentLabel: string | null;
  contextSummary: string | null;
};

type ExpandedApprovalSelection = {
  approvalId: string;
  source: "auto" | "active" | "history";
};

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
  const [expandedSelection, setExpandedSelection] = useState<ExpandedApprovalSelection | null>(
    null,
  );
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
  const autoExpandedApprovalId = useMemo(
    () => pickDefaultExpandedApprovalId(filteredBlockedApprovalIds, approvals.byId),
    [approvals.byId, filteredBlockedApprovalIds],
  );

  const buildApprovalTableRows = (approvalIds: string[]): ApprovalTableRow[] =>
    approvalIds.flatMap((approvalId) => {
      const approval = approvals.byId[approvalId];
      if (!approval) return [];

      return [
        {
          approvalId,
          approval,
          agentLabel: resolveApprovalAgentInfo(approval, managedAgentsByIdentity)?.label ?? null,
          contextSummary: describeApprovalTableContext(approval),
        },
      ];
    });

  const activeRows = useMemo(
    () => buildApprovalTableRows(filteredBlockedApprovalIds),
    [approvals.byId, filteredBlockedApprovalIds, managedAgentsByIdentity],
  );
  const historyRows = useMemo(
    () => buildApprovalTableRows(filteredHistoryApprovalIds),
    [approvals.byId, filteredHistoryApprovalIds, managedAgentsByIdentity],
  );
  const expandedApprovalId = expandedSelection?.approvalId ?? null;

  useEffect(() => {
    const visibleActiveIds = new Set(filteredBlockedApprovalIds);
    const visibleHistoryIds = new Set(filteredHistoryApprovalIds);

    setExpandedSelection((current) => {
      if (current?.source === "active" && visibleActiveIds.has(current.approvalId)) {
        return current;
      }

      if (current?.source === "history" && visibleHistoryIds.has(current.approvalId)) {
        return current;
      }

      if (current?.source === "auto" && visibleActiveIds.has(current.approvalId)) {
        const approval = approvals.byId[current.approvalId];
        if (approval && isApprovalAutoExpandStatus(approval.status)) {
          return current;
        }
      }

      if (autoExpandedApprovalId) {
        return { approvalId: autoExpandedApprovalId, source: "auto" };
      }

      return null;
    });
  }, [
    approvals.byId,
    autoExpandedApprovalId,
    filteredBlockedApprovalIds,
    filteredHistoryApprovalIds,
  ]);

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

  const approvalColumns = useMemo<DataTableColumn<ApprovalTableRow>[]>(
    () => [
      {
        id: "status",
        header: "Status",
        cell: (row) => {
          const statusDisplay = getApprovalStatusDisplay(row.approval.status);
          return <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>;
        },
        headerClassName: "w-[10rem]",
        cellClassName: "align-top",
      },
      {
        id: "kind",
        header: "Kind",
        cell: (row) => <Badge variant="outline">{row.approval.kind}</Badge>,
        headerClassName: "w-[8rem]",
        cellClassName: "align-top",
      },
      {
        id: "request",
        header: "Request",
        cell: (row) => (
          <div className="min-w-[20rem]">
            <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
              {row.approval.prompt}
            </div>
          </div>
        ),
        cellClassName: "align-top",
      },
      {
        id: "agent",
        header: "Agent",
        cell: (row) => (
          <div className="text-xs text-fg-muted break-words [overflow-wrap:anywhere]">
            {row.agentLabel ?? "Unknown"}
          </div>
        ),
        headerClassName: "w-[12rem]",
        cellClassName: "align-top",
      },
      {
        id: "context",
        header: "Context",
        cell: (row) => (
          <div className="text-xs text-fg-muted break-words [overflow-wrap:anywhere]">
            {row.contextSummary ?? "No extra context"}
          </div>
        ),
        headerClassName: "w-[16rem]",
        cellClassName: "align-top",
      },
      {
        id: "created",
        header: "Created",
        cell: (row) => (
          <time
            dateTime={row.approval.created_at}
            className="text-xs text-fg-muted"
            title={row.approval.created_at}
          >
            {formatTimestamp(intl, row.approval.created_at)}
          </time>
        ),
        headerClassName: "w-[10rem]",
        cellClassName: "align-top whitespace-nowrap",
      },
    ],
    [intl],
  );

  return (
    <>
      <AppPage contentClassName="max-w-6xl gap-5">
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
              {activeRows.length > 0 ? (
                <DataTable<ApprovalTableRow>
                  data-testid="approvals-needs-attention-table"
                  columns={approvalColumns}
                  data={activeRows}
                  rowKey={(row) => row.approvalId}
                  testIdPrefix="approval-active-row"
                  expandedRowKey={
                    activeRows.some((row) => row.approvalId === expandedApprovalId)
                      ? expandedApprovalId
                      : null
                  }
                  onExpandedRowChange={(approvalId) =>
                    setExpandedSelection(approvalId ? { approvalId, source: "active" } : null)
                  }
                  renderExpandedRow={(row) => (
                    <ApprovalExpandedRow
                      approvalId={row.approvalId}
                      approval={row.approval}
                      core={core}
                      intl={intl}
                      resolvingDecision={resolvingById[row.approvalId]}
                      runsState={runsState}
                      onResolve={(input) => {
                        void resolveApproval(input);
                      }}
                      onOpenTakeover={takeover.open}
                    />
                  )}
                />
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
              {historyRows.length > 0 ? (
                <DataTable<ApprovalTableRow>
                  data-testid="approvals-history-table"
                  columns={approvalColumns}
                  data={historyRows}
                  rowKey={(row) => row.approvalId}
                  testIdPrefix="approval-history-row"
                  expandedRowKey={
                    historyRows.some((row) => row.approvalId === expandedApprovalId)
                      ? expandedApprovalId
                      : null
                  }
                  onExpandedRowChange={(approvalId) =>
                    setExpandedSelection(approvalId ? { approvalId, source: "history" } : null)
                  }
                  renderExpandedRow={(row) => (
                    <ApprovalExpandedRow
                      approvalId={row.approvalId}
                      approval={row.approval}
                      core={core}
                      intl={intl}
                      resolvingDecision={resolvingById[row.approvalId]}
                      runsState={runsState}
                      onResolve={(input) => {
                        void resolveApproval(input);
                      }}
                      onOpenTakeover={takeover.open}
                    />
                  )}
                />
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
