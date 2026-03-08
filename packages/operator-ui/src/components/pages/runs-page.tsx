import type { OperatorCore } from "@tyrum/operator-core";
import type { ExecutionRun } from "@tyrum/client";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { AppPage } from "../layout/app-page.js";
import { EmptyState } from "../ui/empty-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { buildRunTimeline, sortRunsByCreatedAt } from "./runs-page.lib.js";
import { RunsPageCard } from "./runs-page-card.js";
import { resolveAgentIdForRun } from "../../lib/status-session-lanes.js";

export interface RunsPageProps {
  core: OperatorCore;
  agentId?: string;
  statuses?: ExecutionRun["status"][];
  hideHeader?: boolean;
  title?: string;
}

export function RunsPage({
  core,
  agentId,
  statuses,
  hideHeader = false,
  title = "Runs",
}: RunsPageProps) {
  const runsState = useOperatorStore(core.runsStore);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());

  const runs = useMemo(() => {
    const allRuns = Object.values(runsState.runsById);
    const statusSet = statuses && statuses.length > 0 ? new Set(statuses) : null;
    const filteredRuns = allRuns.filter((run) => {
      if (statusSet && !statusSet.has(run.status)) return false;
      if (typeof agentId === "string" && agentId.trim().length > 0) {
        return resolveAgentIdForRun(run, runsState.agentKeyByRunId) === agentId;
      }
      return true;
    });
    return sortRunsByCreatedAt(filteredRuns);
  }, [agentId, runsState.agentKeyByRunId, runsState.runsById, statuses]);

  const toggleRun = (runId: string): void => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const content =
    runs.length === 0 ? (
      <EmptyState
        icon={Play}
        title="No runs yet"
        description={
          agentId
            ? "Runs for this agent appear here when it starts executing."
            : "Runs appear here when agents start executing."
        }
      />
    ) : (
      <div className="grid gap-4">
        {runs.map((run) => {
          const isExpanded = expandedRunIds.has(run.run_id);

          return (
            <RunsPageCard
              key={run.run_id}
              core={core}
              run={run}
              isExpanded={isExpanded}
              onToggleRun={toggleRun}
              timeline={isExpanded ? buildRunTimeline(run, runsState) : []}
            />
          );
        })}
      </div>
    );

  if (hideHeader) {
    return <div className="grid gap-4">{content}</div>;
  }

  return (
    <AppPage title={title} contentClassName="max-w-5xl gap-4">
      {content}
    </AppPage>
  );
}
