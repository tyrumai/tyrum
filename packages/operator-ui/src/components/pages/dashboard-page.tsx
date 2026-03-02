import type { OperatorCore } from "@tyrum/operator-core";
import type * as React from "react";
import { Activity, Hash, Link2, Play, ShieldCheck, Wallet } from "lucide-react";
import { PageHeader } from "../layout/page-header.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { LiveRegion } from "../ui/live-region.js";
import { Skeleton } from "../ui/skeleton.js";
import { StatusDot } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { getConnectionDisplay } from "../../lib/connection-display.js";
import { useOperatorStore } from "../../use-operator-store.js";

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
  hideHeader?: boolean;
}

function StatCard({
  label,
  icon: Icon,
  value,
  loading = false,
  badge,
  onClick,
  testId,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  loading?: boolean;
  badge?: React.ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const interactive = Boolean(onClick);

  return (
    <Card
      data-testid={testId}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        interactive
          ? "cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
          : null,
        interactive
          ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          : null,
      )}
      onClick={() => {
        onClick?.();
      }}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="text-2xl font-semibold tracking-tight text-fg">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage({ core, onNavigate, hideHeader }: DashboardPageProps) {
  const status = useOperatorStore(core.statusStore);
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const runs = useOperatorStore(core.runsStore);

  const activeRunsCount = Object.values(runs.runsById).filter(
    (run) => run.status === "queued" || run.status === "running" || run.status === "paused",
  ).length;

  const tokensUsed = status.usage?.local.totals.total_tokens;
  const tokensUsedText =
    typeof tokensUsed === "number" ? new Intl.NumberFormat().format(tokensUsed) : "-";

  const connectionDisplay = getConnectionDisplay(connection.status);
  const connectionVariant = connectionDisplay.variant;
  const connectionPulse = connectionDisplay.pulse;
  const connectionLabel = connectionDisplay.label;

  const refreshDashboard = (): void => {
    void Promise.allSettled([
      core.statusStore.refreshStatus(),
      core.statusStore.refreshUsage(),
      core.statusStore.refreshPresence(),
      core.approvalsStore.refreshPending(),
      core.pairingStore.refresh(),
    ]);
  };

  return (
    <div className="grid gap-6">
      {hideHeader ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            data-testid="dashboard-refresh-status"
            onClick={() => {
              refreshDashboard();
            }}
          >
            Refresh
          </Button>
        </div>
      ) : (
        <PageHeader
          title="Dashboard"
          className="mb-0"
          actions={
            <Button
              variant="secondary"
              data-testid="dashboard-refresh-status"
              onClick={() => {
                refreshDashboard();
              }}
            >
              Refresh
            </Button>
          }
        />
      )}

      <LiveRegion data-testid="dashboard-approvals-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Connection Status"
          icon={Activity}
          value={
            <div className="flex items-center gap-2">
              <StatusDot variant={connectionVariant} pulse={connectionPulse} aria-hidden="true" />
              <span>{connectionLabel}</span>
            </div>
          }
        />

        <StatCard
          label="Instance ID"
          icon={Hash}
          loading={status.loading.status}
          value={
            connection.status === "connected" && status.status?.instance_id
              ? status.status.instance_id
              : "-"
          }
        />

        <StatCard
          label="Tokens Used"
          icon={Wallet}
          loading={status.loading.usage}
          value={
            connection.status === "connected" && typeof tokensUsed === "number"
              ? tokensUsedText
              : "-"
          }
        />

        <StatCard label="Active Runs" icon={Play} value={String(activeRunsCount)} />

        <StatCard
          label="Pending Approvals"
          icon={ShieldCheck}
          loading={approvals.loading}
          value={String(approvals.pendingIds.length)}
          badge={
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
        />

        <StatCard
          label="Pending Pairing"
          icon={Link2}
          loading={pairing.loading}
          value={String(pairing.pendingIds.length)}
        />
      </div>
    </div>
  );
}
