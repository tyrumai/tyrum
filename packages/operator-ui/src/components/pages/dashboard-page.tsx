import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Activity, Bot, Link2, ShieldCheck, Tag } from "lucide-react";
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
  parseAgentIdFromKey,
} from "../../lib/status-session-lanes.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useOperatorStore } from "../../use-operator-store.js";

export interface DashboardPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
  hideHeader?: boolean;
}

type DesktopUpdateSnapshot = {
  stage: string;
  currentVersion: string;
  availableVersion: string | null;
};

function readDesktopUpdateSnapshot(value: unknown): DesktopUpdateSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const stage = typeof rec["stage"] === "string" ? (rec["stage"] as string) : null;
  const currentVersion =
    typeof rec["currentVersion"] === "string" ? (rec["currentVersion"] as string) : null;
  const availableRaw = rec["availableVersion"];
  const availableVersion =
    availableRaw === null || typeof availableRaw === "string" ? availableRaw : null;
  if (!stage || !currentVersion) return null;
  return { stage, currentVersion, availableVersion };
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
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateSnapshot | null>(null);

  useEffect(() => {
    if (!desktopApi?.updates) {
      setDesktopUpdate(null);
      return;
    }
    let disposed = false;

    void desktopApi.updates
      .getState()
      .then((snapshot) => {
        if (disposed) return;
        setDesktopUpdate(readDesktopUpdateSnapshot(snapshot));
      })
      .catch(() => {
        // Ignore snapshot failures; event updates can still refresh the state.
      });

    const unsubscribe = desktopApi.onUpdateStateChange
      ? desktopApi.onUpdateStateChange((next) => {
          if (disposed) return;
          setDesktopUpdate(readDesktopUpdateSnapshot(next));
        })
      : null;
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopApi]);

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

  const connectionDisplay = getConnectionDisplay(connection.status);
  const connectionVariant = connectionDisplay.variant;
  const connectionPulse = connectionDisplay.pulse;
  const connectionLabel = connectionDisplay.label;

  const updateAvailable = desktopUpdate?.stage === "available";

  return (
    <div className="grid gap-6">
      {hideHeader ? null : <PageHeader title="Dashboard" className="mb-0" />}

      <LiveRegion data-testid="dashboard-approvals-live">
        {approvals.pendingIds.length} pending approvals
      </LiveRegion>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Connection Status"
          icon={Activity}
          testId="dashboard-card-connection"
          value={
            <div className="flex items-center gap-2">
              <StatusDot variant={connectionVariant} pulse={connectionPulse} aria-hidden="true" />
              <span>{connectionLabel}</span>
            </div>
          }
        />

        <StatCard
          label="Version"
          icon={Tag}
          loading={status.loading.status && status.status === null}
          value={status.status?.version ?? "-"}
          badge={
            updateAvailable ? (
              <Badge variant="warning" data-testid="dashboard-version-update-badge">
                Update
              </Badge>
            ) : null
          }
          onClick={() => {
            onNavigate?.("settings");
            setTimeout(() => {
              const el = document.getElementById("settings-update");
              if (!el) return;
              if (typeof (el as HTMLElement).scrollIntoView !== "function") return;
              (el as HTMLElement).scrollIntoView({ block: "start" });
            }, 0);
          }}
          testId="dashboard-card-version"
        />

        <StatCard
          label="Active Agents"
          icon={Bot}
          value={activeAgentsText}
          badge={
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
        />

        <StatCard
          label="Pending Approvals"
          icon={ShieldCheck}
          loading={approvals.loading && approvals.lastSyncedAt === null}
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
          label="Pending Pairings"
          icon={Link2}
          loading={pairing.loading && pairing.lastSyncedAt === null}
          value={String(pairing.pendingIds.length)}
          badge={
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
        />
      </div>
    </div>
  );
}
