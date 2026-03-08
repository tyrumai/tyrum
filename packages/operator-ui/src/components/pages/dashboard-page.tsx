import type { OperatorCore } from "@tyrum/operator-core";
import type * as React from "react";
import { PageHeader } from "../layout/page-header.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { LiveRegion } from "../ui/live-region.js";
import { Skeleton } from "../ui/skeleton.js";
import { StatusDot } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { getConnectionDisplay } from "../../lib/connection-display.js";
import {
  getActiveAgentIdsFromSessionLanes,
  getActiveExecutionRunsCountFromQueueDepth,
  parseAgentIdFromKey,
} from "../../lib/status-session-lanes.js";
import { useOperatorStore } from "../../use-operator-store.js";

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
  hideHeader?: boolean;
}

function SummaryRow({
  label,
  value,
  description,
  loading = false,
  status,
  onClick,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  loading?: boolean;
  status?: React.ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const interactive = onClick !== undefined;
  const content = (
    <>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description ? <div className="mt-1 text-sm text-fg-muted">{description}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        {loading ? (
          <Skeleton className="ml-auto h-6 w-20" />
        ) : (
          <div className="text-lg font-semibold text-fg">{value}</div>
        )}
        {status ? <div className="mt-1 flex justify-end">{status}</div> : null}
      </div>
    </>
  );

  const sharedClassName = cn(
    "flex w-full items-start justify-between gap-4 px-5 py-4 text-left",
    interactive ? "cursor-pointer transition-colors hover:bg-bg-subtle" : null,
    interactive
      ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      : null,
  );

  if (!onClick) {
    return (
      <div data-testid={testId} className={sharedClassName}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      className={sharedClassName}
      onClick={() => {
        onClick();
      }}
    >
      {content}
    </button>
  );
}

export function DashboardPage({ core, onNavigate, hideHeader }: DashboardPageProps) {
  const status = useOperatorStore(core.statusStore);
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const runs = useOperatorStore(core.runsStore);
  const workboard = useOperatorStore(core.workboardStore);

  const agentIds = new Set<string>();
  const activeAgentIds = new Set<string>();
  for (const run of Object.values(runs.runsById)) {
    const agentId = parseAgentIdFromKey(run.key);
    if (!agentId) continue;
    agentIds.add(agentId);
    if (run.status === "queued" || run.status === "running" || run.status === "paused") {
      activeAgentIds.add(agentId);
    }
  }
  for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
    activeAgentIds.add(agentId);
  }
  const activeAgentsCount = activeAgentIds.size;
  const totalAgentIds = new Set<string>(agentIds);
  for (const agentId of activeAgentIds) {
    totalAgentIds.add(agentId);
  }
  const totalAgentsCount = totalAgentIds.size;
  const activeAgentsText =
    totalAgentsCount > 0 ? `${activeAgentsCount}/${totalAgentsCount}` : `${activeAgentsCount}/-`;

  let openWorkCount = 0;
  let activeWorkCount = 0;
  for (const item of workboard.items) {
    if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") {
      openWorkCount += 1;
    }
    if (item.status === "doing" || item.status === "blocked") {
      activeWorkCount += 1;
    }
  }

  const activeRunsCount = getActiveExecutionRunsCountFromQueueDepth(status.status?.queue_depth);
  const connectionDisplay = getConnectionDisplay(connection.status);

  return (
    <div className="grid gap-6">
      {hideHeader ? null : <PageHeader title="Dashboard" className="mb-0" />}

      <LiveRegion data-testid="dashboard-approvals-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <h2 className="text-base font-semibold">System</h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              <SummaryRow
                label="Connection"
                testId="dashboard-card-connection"
                value={
                  <div className="flex items-center gap-2">
                    <StatusDot
                      variant={connectionDisplay.variant}
                      pulse={connectionDisplay.pulse}
                      aria-hidden="true"
                    />
                    <span>{connectionDisplay.label}</span>
                  </div>
                }
                description="Current gateway session state."
              />

              <SummaryRow
                label="Pending approvals"
                loading={approvals.loading && approvals.lastSyncedAt === null}
                value={String(approvals.pendingIds.length)}
                status={
                  approvals.pendingIds.length > 0 ? (
                    <Badge data-testid="dashboard-approvals-badge" variant="danger">
                      {approvals.pendingIds.length}
                    </Badge>
                  ) : null
                }
                onClick={() => {
                  onNavigate?.("approvals");
                }}
                testId="dashboard-card-approvals"
                description="Actions waiting for operator review."
              />

              <SummaryRow
                label="Pending pairings"
                loading={pairing.loading && pairing.lastSyncedAt === null}
                value={String(pairing.pendingIds.length)}
                status={
                  pairing.pendingIds.length > 0 ? (
                    <Badge data-testid="dashboard-pairing-badge" variant="danger">
                      {pairing.pendingIds.length}
                    </Badge>
                  ) : null
                }
                onClick={() => {
                  onNavigate?.("pairing");
                }}
                testId="dashboard-card-pairing"
                description="Devices waiting for approval."
              />

              <SummaryRow
                label="Active runs"
                loading={status.loading.status && status.status === null}
                value={activeRunsCount === null ? "-" : String(activeRunsCount)}
                status={
                  activeRunsCount !== null && activeRunsCount > 0 ? (
                    <Badge data-testid="dashboard-runs-badge" variant="default">
                      {activeRunsCount}
                    </Badge>
                  ) : null
                }
                onClick={() => {
                  onNavigate?.("agents");
                }}
                testId="dashboard-card-runs"
                description="Queued or running execution work."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border pb-4">
            <h2 className="text-base font-semibold">Work</h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              <SummaryRow
                label="Open work"
                loading={workboard.loading && workboard.items.length === 0}
                value={String(openWorkCount)}
                onClick={() => {
                  onNavigate?.("workboard");
                }}
                testId="dashboard-card-open-work"
                description="Items that are not complete yet."
              />

              <SummaryRow
                label="Active work"
                loading={workboard.loading && workboard.items.length === 0}
                value={String(activeWorkCount)}
                onClick={() => {
                  onNavigate?.("workboard");
                }}
                testId="dashboard-card-active-work"
                description="Items currently doing or blocked."
              />

              <SummaryRow
                label="Active agents"
                value={activeAgentsText}
                status={
                  activeAgentsCount > 0 ? (
                    <Badge variant="default" data-testid="dashboard-agents-badge">
                      {activeAgentsCount}
                    </Badge>
                  ) : null
                }
                onClick={() => {
                  onNavigate?.("agents");
                }}
                testId="dashboard-card-agents"
                description="Running agents compared with known agents."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
