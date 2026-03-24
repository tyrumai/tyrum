import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { Bot, Inbox, Play, ShieldCheck, SquareKanban } from "lucide-react";
import {
  DashboardRecentRunsTable,
  type DashboardRecentRunRow,
} from "./dashboard-page.activity-table.js";
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
  ConfigHealthCard,
  getAuthSeverity,
  getElevatedExecutionSeverity,
  getExposureSeverity,
  getPolicyModeSeverity,
  getSandboxHardeningSeverity,
  getSandboxModeSeverity,
  KpiCard,
  SecurityStatusValue,
  StatusRow,
  WorkDistributionBar,
} from "./dashboard-page.parts.js";
import { useNodeInventory } from "./pairing-page.inventory.js";
import type { AgentsPageNavigationIntent } from "./agents-page.lib.js";
import {
  buildAgentNameByKey,
  buildDashboardRecentRunsState,
  buildDashboardWorkDistribution,
  buildTranscriptSessionsByKey,
  getAuthEnabledLabel,
  getElevatedExecutionLabel,
  getPolicyModeLabel,
  getSandboxHardeningLabel,
  normalizeManagedAgentKeys,
} from "./dashboard-page.logic.js";

const DASHBOARD_WIDE_CONTENT_WIDTH_PX = 768;

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string, tab?: string) => void;
  onOpenAgentRun?: (intent: AgentsPageNavigationIntent) => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
  connectionRouteId?: "configure" | "desktop" | "mobile";
}

export function DashboardPage({
  core,
  onNavigate,
  onOpenAgentRun,
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
  const chat = useOperatorStore(core.chatStore);
  const transcript = useOperatorStore(core.transcriptStore);
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
  const activeRunAgentKeys = new Set<string>();
  for (const run of Object.values(runs.runsById)) {
    if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") {
      continue;
    }
    const agentId = resolveAgentIdForRun(run, runs.agentKeyByRunId);
    if (!agentId) continue;
    activeRunAgentKeys.add(agentId);
  }
  for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
    activeRunAgentKeys.add(agentId);
  }
  const managedAgentKeys = normalizeManagedAgentKeys(chat.agents.agents);
  const activeAgentsCount =
    managedAgentKeys.length === 0
      ? activeRunAgentKeys.size
      : managedAgentKeys.filter((agentKey) => activeRunAgentKeys.has(agentKey)).length;
  const activeAgentsText =
    managedAgentKeys.length === 0
      ? `${activeAgentsCount}/-`
      : `${activeAgentsCount}/${managedAgentKeys.length}`;
  const activeAgentsLoading =
    chat.agents.loading &&
    managedAgentKeys.length === 0 &&
    (connection.status === "connected" ||
      (connection.status === "connecting" && connection.recovering));
  const activeAgentsAriaLabel =
    managedAgentKeys.length === 0
      ? `${activeAgentsCount} active agents, managed total unavailable, navigate to agents`
      : `${activeAgentsCount} active agents out of ${managedAgentKeys.length} managed, navigate to agents`;

  const { openWorkCount, activeWorkCount, workSegments, workTotal } = React.useMemo(
    () => buildDashboardWorkDistribution(workboard.items),
    [workboard.items],
  );

  const activeRunsCount = getActiveExecutionRunsCountFromQueueDepth(status.status?.queue_depth);
  const connectionDisplay = getConnectionDisplay(connection.status);
  const connectedNodesCount = nodeInventory.nodes.filter((node) => node.connected).length;
  const configHealth = status.status?.config_health ?? null;
  const configHealthIssues = configHealth?.issues ?? [];
  const statusLoading = status.loading.status && status.status === null;
  const openConnectionSettings = React.useCallback(() => {
    onNavigate?.(connectionRouteId);
  }, [connectionRouteId, onNavigate]);
  const openPolicySettings = React.useCallback(() => {
    onNavigate?.("configure", "policy");
  }, [onNavigate]);
  const openTokenSettings = React.useCallback(() => {
    onNavigate?.("configure", "device-tokens");
  }, [onNavigate]);
  const agentNameByKey = React.useMemo(
    () => buildAgentNameByKey(chat.agents.agents),
    [chat.agents.agents],
  );

  // -- Derived: recent runs
  const transcriptSessionsByKey = React.useMemo(
    () => buildTranscriptSessionsByKey(transcript.sessions),
    [transcript.sessions],
  );
  const recentRunsState = React.useMemo(
    () =>
      buildDashboardRecentRunsState({
        runsById: runs.runsById,
        agentKeyByRunId: runs.agentKeyByRunId,
        agentNameByKey,
        transcriptSessionsByKey,
      }),
    [agentNameByKey, runs.agentKeyByRunId, runs.runsById, transcriptSessionsByKey],
  );
  const recentRunRows = recentRunsState.rows;
  const missingRecentRunSessionsKey = recentRunsState.missingTranscriptKeysKey;
  const lastTranscriptLookupKeyRef = React.useRef("");
  React.useEffect(() => {
    if (!missingRecentRunSessionsKey) {
      lastTranscriptLookupKeyRef.current = "";
      return;
    }
    if (connection.status !== "connected" || transcript.loadingList) {
      return;
    }
    if (lastTranscriptLookupKeyRef.current === missingRecentRunSessionsKey) {
      return;
    }
    lastTranscriptLookupKeyRef.current = missingRecentRunSessionsKey;
    void core.transcriptStore.refresh();
  }, [
    connection.status,
    core.transcriptStore,
    missingRecentRunSessionsKey,
    transcript.loadingList,
  ]);
  const handleRecentRunSelect = React.useCallback(
    (row: DashboardRecentRunRow) => {
      if (onOpenAgentRun) {
        onOpenAgentRun({
          agentKey: row.agentKey,
          runId: row.runId,
          sessionKey: row.sessionKey,
        });
        return;
      }
      onNavigate?.("agents");
    },
    [onNavigate, onOpenAgentRun],
  );

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
          onClick={onNavigate ? () => onNavigate("agents") : undefined}
          testId="dashboard-card-runs"
          ariaLabel={`${activeRunsCount ?? 0} active runs, navigate to agents`}
        />
        <KpiCard
          icon={Bot}
          value={activeAgentsText}
          label="Active Agents"
          loading={activeAgentsLoading}
          onClick={onNavigate ? () => onNavigate("agents") : undefined}
          testId="dashboard-card-agents"
          ariaLabel={activeAgentsAriaLabel}
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
            <SectionHeading as="h3">System Status</SectionHeading>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow
              label="Connection"
              testId="dashboard-card-connection"
              onClick={onNavigate ? openConnectionSettings : undefined}
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
              label="Sandbox mode"
              ariaLabel="Open policy settings"
              helpAriaLabel="Explain sandbox mode"
              helpText="Shows whether agent runs are currently sandboxed and whether the sandbox is actively enforcing restrictions."
              testId="dashboard-card-sandbox-mode"
              loading={statusLoading}
              onClick={onNavigate ? openPolicySettings : undefined}
              value={
                <SecurityStatusValue
                  label={status.status?.sandbox?.mode ?? "disabled"}
                  severity={getSandboxModeSeverity(status.status)}
                />
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <SectionHeading as="h3">Security</SectionHeading>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow
              label="Network exposure"
              ariaLabel="Open connection settings"
              helpAriaLabel="Explain network exposure"
              helpText="Shows whether the gateway is only reachable from this machine or exposed to other machines on the network."
              testId="dashboard-card-network-exposure"
              loading={statusLoading}
              onClick={onNavigate ? openConnectionSettings : undefined}
              value={
                status.status ? (
                  <SecurityStatusValue
                    label={status.status.is_exposed ? "exposed" : "local only"}
                    severity={getExposureSeverity(status.status.is_exposed)}
                  />
                ) : (
                  "-"
                )
              }
            />
            <StatusRow
              label="Authentication"
              ariaLabel="Open token settings"
              helpAriaLabel="Explain authentication"
              helpText="Shows whether API and operator access require a valid token."
              testId="dashboard-card-authentication"
              loading={statusLoading}
              onClick={onNavigate ? openTokenSettings : undefined}
              value={
                <SecurityStatusValue
                  label={getAuthEnabledLabel(status.status)}
                  severity={getAuthSeverity(status.status)}
                />
              }
            />
            <StatusRow
              label="Policy mode"
              ariaLabel="Open policy settings"
              helpAriaLabel="Explain policy mode"
              helpText="Shows whether the active policy is only being observed or is actively enforced when agent actions are evaluated."
              testId="dashboard-card-policy-mode"
              loading={statusLoading}
              onClick={onNavigate ? openPolicySettings : undefined}
              value={
                <SecurityStatusValue
                  label={getPolicyModeLabel(status.status)}
                  severity={getPolicyModeSeverity(status.status)}
                />
              }
            />
            <StatusRow
              label="Sandbox hardening"
              ariaLabel="Open policy settings"
              helpAriaLabel="Explain sandbox hardening"
              helpText="Shows which hardening profile the sandbox uses. Hardened applies stricter containment than the baseline profile."
              testId="dashboard-card-sandbox-hardening"
              loading={statusLoading}
              onClick={onNavigate ? openPolicySettings : undefined}
              value={
                <SecurityStatusValue
                  label={getSandboxHardeningLabel(status.status)}
                  severity={getSandboxHardeningSeverity(status.status)}
                />
              }
            />
            <StatusRow
              label="Elevated execution"
              ariaLabel="Open policy settings"
              helpAriaLabel="Explain elevated execution"
              helpText="Shows whether work can request higher-privilege execution outside the default sandbox restrictions."
              testId="dashboard-card-elevated-execution"
              loading={statusLoading}
              onClick={onNavigate ? openPolicySettings : undefined}
              value={
                <SecurityStatusValue
                  label={getElevatedExecutionLabel(status.status)}
                  severity={getElevatedExecutionSeverity(status.status)}
                />
              }
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

      {/* Recent Runs */}
      <Card>
        <CardHeader className="pb-0">
          <SectionHeading as="h3">Recent Runs</SectionHeading>
        </CardHeader>
        <CardContent>
          {recentRunRows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No recent runs"
              description="Runs from agents will appear here."
              className="py-8"
            />
          ) : (
            <DashboardRecentRunsTable
              rows={recentRunRows}
              onRowClick={onOpenAgentRun || onNavigate ? handleRecentRunSelect : undefined}
            />
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
}
