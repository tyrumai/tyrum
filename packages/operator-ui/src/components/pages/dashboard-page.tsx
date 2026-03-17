import type { StatusResponse } from "@tyrum/client";
import type { ActivityEvent, ActivityWorkstream, OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { Bot, Inbox, Play, ShieldCheck, SquareKanban } from "lucide-react";
import { AppPage } from "../layout/app-page.js";
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LiveRegion } from "../ui/live-region.js";
import { SectionHeading } from "../ui/section-heading.js";
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
  ConfigHealthCard,
  KpiCard,
  StatusRow,
  WorkDistributionBar,
  type WorkSegment,
} from "./dashboard-page.parts.js";
import { useNodeInventory } from "./pairing-page.inventory.js";

const DASHBOARD_WIDE_CONTENT_WIDTH_PX = 768;

function getPolicyModeLabel(status: StatusResponse | null): string {
  if (status?.sandbox) return status.sandbox.mode;
  if (!status?.policy) return "-";
  return status.policy.observe_only ? "observe" : "enforce";
}

function getSandboxHardeningLabel(status: StatusResponse | null): string {
  return status?.sandbox?.hardening_profile ?? "-";
}

function getElevatedExecutionLabel(status: StatusResponse | null): string {
  const value = status?.sandbox?.elevated_execution_available;
  if (value === null || value === undefined) return "unknown";
  return value ? "available" : "unavailable";
}

function getAuthEnabledLabel(status: StatusResponse | null): string {
  const enabled = status?.auth?.enabled;
  if (enabled === undefined) return "-";
  return enabled ? "enabled" : "disabled";
}

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
  connectionRouteId?: "configure" | "desktop" | "mobile";
}

export function DashboardPage({
  core,
  onNavigate,
  onboardingAvailable = false,
  onOpenOnboarding,
  connectionRouteId = "configure",
}: DashboardPageProps) {
  const wideDashboard = useAppShellMinWidth(DASHBOARD_WIDE_CONTENT_WIDTH_PX);
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
  const configHealth = status.status?.config_health ?? null;
  const configHealthIssues = configHealth?.issues ?? [];
  const statusLoading = status.loading.status && status.status === null;

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

      {configHealthIssues.length > 0 ? (
        <ConfigHealthCard
          issues={configHealthIssues}
          onNavigate={onNavigate}
          onboardingAvailable={onboardingAvailable}
          onOpenOnboarding={onOpenOnboarding}
        />
      ) : null}

      {/* KPI Grid */}
      <div
        data-testid="dashboard-kpi-grid"
        className={cn("grid min-w-0 gap-3", wideDashboard ? "grid-cols-4" : "grid-cols-2")}
      >
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

      {/* System Status + Security */}
      <div
        data-testid="dashboard-summary-grid"
        className={cn("grid min-w-0 gap-3", wideDashboard ? "grid-cols-2" : "grid-cols-1")}
      >
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading as="h3" className="font-semibold">
              System Status
            </SectionHeading>
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
              loading={statusLoading}
              value={status.status?.version ?? "-"}
            />
            <StatusRow
              label="Database"
              loading={statusLoading}
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
              loading={statusLoading}
              value={status.status?.sandbox?.mode ?? "disabled"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <SectionHeading as="h3" className="font-semibold">
              Security
            </SectionHeading>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow
              label="Exposure"
              loading={statusLoading}
              value={status.status ? (status.status.is_exposed ? "exposed" : "local only") : "-"}
            />
            <StatusRow
              label="Auth"
              loading={statusLoading}
              value={getAuthEnabledLabel(status.status)}
            />
            <StatusRow
              label="Policy"
              loading={statusLoading}
              value={getPolicyModeLabel(status.status)}
            />
            <StatusRow
              label="Sandbox hardening"
              loading={statusLoading}
              value={getSandboxHardeningLabel(status.status)}
            />
            <StatusRow
              label="Elevated execution"
              loading={statusLoading}
              value={getElevatedExecutionLabel(status.status)}
            />
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
          <SectionHeading as="h3" className="font-semibold">
            Recent Activity
          </SectionHeading>
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
