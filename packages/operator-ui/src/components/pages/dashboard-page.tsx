import type { ActivityEvent, ActivityWorkstream, OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { Bot, Inbox, Play, ShieldCheck, SquareKanban } from "lucide-react";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
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
import {
  ActivityFeedItem,
  KpiCard,
  StatusRow,
  TokenUsageBar,
  WorkDistributionBar,
  type WorkSegment,
} from "./dashboard-page.parts.js";
import { useNodeInventory } from "./pairing-page.inventory.js";

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
  connectionRouteId?: "configure" | "desktop";
}

export function DashboardPage({
  core,
  onNavigate,
  connectionRouteId = "configure",
}: DashboardPageProps) {
  const status = useOperatorStore(core.statusStore);
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const runs = useOperatorStore(core.runsStore);
  const workboard = useOperatorStore(core.workboardStore);
  const activity = useOperatorStore(core.activityStore);
  const nodeInventory = useNodeInventory({
    core,
    connected:
      connection.status === "connected" ||
      (connection.status === "connecting" && connection.recovering),
    refreshAt: pairing.lastSyncedAt,
  });

  // Force re-render every 30s so relative timestamps stay fresh
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // -- Derived: agents
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
  const totalAgentIds = new Set([...agentIds, ...activeAgentIds]);
  const activeAgentsText =
    totalAgentIds.size > 0
      ? `${activeAgentIds.size}/${totalAgentIds.size}`
      : `${activeAgentIds.size}/-`;

  // -- Derived: work counts
  let openWorkCount = 0;
  let activeWorkCount = 0;
  const workStatusCounts = {
    backlog: 0,
    ready: 0,
    doing: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const item of workboard.items) {
    if (item.status in workStatusCounts) {
      workStatusCounts[item.status as keyof typeof workStatusCounts] += 1;
    }
    if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") {
      openWorkCount += 1;
    }
    if (item.status === "doing" || item.status === "blocked") {
      activeWorkCount += 1;
    }
  }
  const workSegments: WorkSegment[] = [
    { key: "backlog", count: workStatusCounts.backlog, color: "bg-neutral", label: "Backlog" },
    { key: "ready", count: workStatusCounts.ready, color: "bg-neutral", label: "Ready" },
    { key: "doing", count: workStatusCounts.doing, color: "bg-primary", label: "Doing" },
    { key: "blocked", count: workStatusCounts.blocked, color: "bg-warning", label: "Blocked" },
    { key: "done", count: workStatusCounts.done, color: "bg-success", label: "Done" },
    { key: "failed", count: workStatusCounts.failed, color: "bg-error", label: "Failed" },
    {
      key: "cancelled",
      count: workStatusCounts.cancelled,
      color: "bg-fg-muted/40",
      label: "Cancelled",
    },
  ];
  const workTotal = workSegments.reduce((sum, s) => sum + s.count, 0);

  const activeRunsCount = getActiveExecutionRunsCountFromQueueDepth(status.status?.queue_depth);
  const connectionDisplay = getConnectionDisplay(connection.status);
  const connectedNodesCount = nodeInventory.nodes.filter((node) => node.connected).length;
  const usage = status.usage;

  // -- Derived: recent activity
  const recentEvents = React.useMemo(() => {
    const events: Array<{ agentName: string; event: ActivityEvent }> = [];
    for (const wsId of activity.workstreamIds) {
      const ws: ActivityWorkstream | undefined = activity.workstreamsById[wsId];
      if (!ws) continue;
      const name = ws.persona.name || ws.agentId;
      for (const event of ws.recentEvents) {
        events.push({ agentName: name, event });
      }
    }
    events.sort(
      (a, b) => new Date(b.event.occurredAt).getTime() - new Date(a.event.occurredAt).getTime(),
    );
    return events.slice(0, 8);
  }, [activity.workstreamIds, activity.workstreamsById]);

  return (
    <AppPage contentClassName="max-w-5xl gap-5">
      <LiveRegion data-testid="dashboard-approvals-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      {/* Connection Banner */}
      {connection.status !== "connected" &&
        (onNavigate ? (
          <button
            type="button"
            className={cn(
              "w-full cursor-pointer text-left",
              "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            )}
            onClick={() => onNavigate(connectionRouteId)}
          >
            <Alert
              variant={connection.status === "connecting" ? "warning" : "error"}
              title={
                <span className="inline-flex items-center gap-2">
                  <StatusDot
                    variant={connectionDisplay.variant}
                    pulse={connectionDisplay.pulse}
                    aria-hidden="true"
                  />
                  {connectionDisplay.label}
                </span>
              }
              description={connection.transportError ?? undefined}
            />
          </button>
        ) : (
          <Alert
            variant={connection.status === "connecting" ? "warning" : "error"}
            title={
              <span className="inline-flex items-center gap-2">
                <StatusDot
                  variant={connectionDisplay.variant}
                  pulse={connectionDisplay.pulse}
                  aria-hidden="true"
                />
                {connectionDisplay.label}
              </span>
            }
            description={connection.transportError ?? undefined}
          />
        ))}

      {/* KPI Grid */}
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={ShieldCheck}
          value={String(approvals.pendingIds.length)}
          label="Pending Approvals"
          loading={approvals.loading && approvals.lastSyncedAt === null}
          valueClassName={approvals.pendingIds.length > 0 ? "text-warning" : undefined}
          onClick={onNavigate ? () => onNavigate("approvals") : undefined}
          testId="dashboard-card-approvals"
          ariaLabel={`${approvals.pendingIds.length} pending approvals, navigate to approvals`}
        />
        <KpiCard
          icon={Play}
          value={activeRunsCount === null ? "-" : String(activeRunsCount)}
          label="Active Runs"
          loading={status.loading.status && status.status === null}
          onClick={onNavigate ? () => onNavigate("runs") : undefined}
          testId="dashboard-card-runs"
          ariaLabel={`${activeRunsCount ?? 0} active runs, navigate to runs`}
        />
        <KpiCard
          icon={Bot}
          value={activeAgentsText}
          label="Active Agents"
          onClick={onNavigate ? () => onNavigate("agents") : undefined}
          testId="dashboard-card-agents"
          ariaLabel={`${activeAgentIds.size} active agents, navigate to agents`}
        />
        <KpiCard
          icon={SquareKanban}
          value={String(openWorkCount)}
          label="Open Work"
          subtitle={activeWorkCount > 0 ? `${activeWorkCount} in progress` : undefined}
          loading={workboard.loading && workboard.items.length === 0}
          onClick={onNavigate ? () => onNavigate("workboard") : undefined}
          testId="dashboard-card-open-work"
          ariaLabel={`${openWorkCount} open work items, navigate to workboard`}
        />
      </div>

      {/* System Status + Usage */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">System Status</h3>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow
              label="Connection"
              testId="dashboard-card-connection"
              onClick={onNavigate ? () => onNavigate(connectionRouteId) : undefined}
              value={
                <span className="inline-flex items-center gap-2">
                  <StatusDot
                    variant={connectionDisplay.variant}
                    pulse={connectionDisplay.pulse}
                    aria-hidden="true"
                  />
                  {connectionDisplay.label}
                </span>
              }
            />
            <StatusRow
              label="Version"
              loading={status.loading.status && status.status === null}
              value={status.status?.version ?? "-"}
            />
            <StatusRow
              label="Database"
              loading={status.loading.status && status.status === null}
              value={status.status?.db_kind ?? "-"}
            />
            <StatusRow
              label="Connected nodes"
              testId="dashboard-card-connected-nodes"
              value={String(connectedNodesCount)}
              loading={nodeInventory.loading && nodeInventory.nodes.length === 0}
              onClick={onNavigate ? () => onNavigate("pairing") : undefined}
            />
            <StatusRow
              label="Pending nodes"
              loading={pairing.loading && pairing.lastSyncedAt === null}
              testId="dashboard-card-pairing"
              onClick={onNavigate ? () => onNavigate("pairing") : undefined}
              value={
                <span className={pairing.pendingIds.length > 0 ? "text-warning" : undefined}>
                  {String(pairing.pendingIds.length)}
                </span>
              }
            />
            <StatusRow
              label="Sandbox"
              loading={status.loading.status && status.status === null}
              value={
                status.status?.sandbox
                  ? typeof status.status.sandbox === "object" &&
                    status.status.sandbox !== null &&
                    "profile" in status.status.sandbox
                    ? String((status.status.sandbox as { profile: string }).profile)
                    : "enabled"
                  : "disabled"
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">Token Usage</h3>
          </CardHeader>
          <CardContent>
            {status.loading.usage && usage === null ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-5 w-24" />
              </div>
            ) : usage === null ? (
              <div className="py-4 text-center text-sm text-fg-muted">Usage unavailable</div>
            ) : (
              <div className="space-y-3">
                <StatusRow
                  label="Total tokens"
                  value={usage.local.totals.total_tokens.toLocaleString()}
                />
                <TokenUsageBar
                  inputTokens={usage.local.totals.input_tokens}
                  outputTokens={usage.local.totals.output_tokens}
                />
                <StatusRow
                  label="Est. cost"
                  value={`$${(usage.local.totals.usd_micros / 1_000_000).toFixed(2)}`}
                />
                <StatusRow
                  label="Attempts"
                  value={usage.local.attempts.total_with_cost.toLocaleString()}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Work Distribution */}
      {workboard.supported !== false && (
        <WorkDistributionBar
          segments={workSegments}
          total={workTotal}
          onClick={onNavigate ? () => onNavigate("workboard") : undefined}
        />
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-0">
          <h3 className="text-sm font-semibold">Recent Activity</h3>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No recent activity"
              description="Activity from agents will appear here."
              className="py-8"
            />
          ) : (
            <ul role="list" className="divide-y divide-border">
              {recentEvents.map((item) => (
                <ActivityFeedItem
                  key={item.event.id}
                  agentName={item.agentName}
                  event={item.event}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
}
