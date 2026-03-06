import type { OperatorCore } from "@tyrum/operator-core";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../ui/empty-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { buildRunTimeline, sortRunsByCreatedAt } from "./runs-page.lib.js";
import { RunsPageCard } from "./runs-page-card.js";
import { parseAgentIdFromKey } from "../../lib/status-session-lanes.js";
import { PageHeader } from "../layout/page-header.js";

export interface RunsPageProps {
  core: OperatorCore;
  agentId?: string;
  hideHeader?: boolean;
  title?: string;
}

export function RunsPage({ core, agentId, hideHeader = false, title = "Runs" }: RunsPageProps) {
  const runsState = useOperatorStore(core.runsStore);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());

  const runs = useMemo(() => {
    const allRuns = Object.values(runsState.runsById);
    const filteredRuns =
      typeof agentId === "string" && agentId.trim().length > 0
        ? allRuns.filter((run) => parseAgentIdFromKey(run.key) === agentId)
        : allRuns;
    return sortRunsByCreatedAt(filteredRuns);
  }, [agentId, runsState.runsById]);

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

  return (
    <div className="grid gap-6">
      {hideHeader ? null : <PageHeader title={title} className="mb-0" />}

      {runs.length === 0 ? (
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
      )}
    </div>
  );
}
