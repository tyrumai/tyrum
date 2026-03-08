import type { OperatorCore } from "@tyrum/operator-core";
import type * as React from "react";
import { PageHeader } from "../layout/page-header.js";
import { LiveRegion } from "../ui/live-region.js";
import { Skeleton } from "../ui/skeleton.js";
import { StatusDot } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { getConnectionDisplay } from "../../lib/connection-display.js";
import {
  getActiveAgentIdsFromSessionLanes,
  getActiveExecutionRunsCountFromQueueDepth,
  resolveAgentIdForRun,
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
  onClick,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const interactive = onClick !== undefined;
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description ? <div className="mt-0.5 text-sm text-fg-muted">{description}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        {loading ? (
          <Skeleton className="ml-auto h-6 w-20" />
        ) : (
          <div className="text-lg font-semibold text-fg">{value}</div>
        )}
      </div>
    </>
  );

  const sharedClassName = cn(
    "flex min-w-0 w-full items-start justify-between gap-3 px-3 py-2.5 text-left",
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

function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border bg-bg-card/40">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
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
    const agentId = resolveAgentIdForRun(run, runs.agentKeyByRunId);
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
    <div className="grid min-w-0 gap-4">
      {hideHeader ? null : <PageHeader title="Dashboard" className="mb-0" />}

      <LiveRegion data-testid="dashboard-approvals-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      <div className="grid min-w-0 gap-3">
        <DashboardSection title="System">
          <SummaryRow
            label="Connection"
            testId="dashboard-card-connection"
            value={
              <span className="inline-flex max-w-full items-center gap-2">
                <StatusDot
                  variant={connectionDisplay.variant}
                  pulse={connectionDisplay.pulse}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {connectionDisplay.label}
                </span>
              </span>
            }
            description="Current gateway session state."
          />

          <SummaryRow
            label="Pending approvals"
            loading={approvals.loading && approvals.lastSyncedAt === null}
            value={String(approvals.pendingIds.length)}
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
            onClick={() => {
              onNavigate?.("runs");
            }}
            testId="dashboard-card-runs"
            description="Queued or running execution work."
          />
        </DashboardSection>

        <DashboardSection title="Work">
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
            onClick={() => {
              onNavigate?.("agents");
            }}
            testId="dashboard-card-agents"
            description="Running agents compared with known agents."
          />
        </DashboardSection>
      </div>
    </div>
  );
}
