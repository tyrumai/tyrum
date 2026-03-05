import type { OperatorCore } from "@tyrum/operator-core";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../ui/empty-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { buildRunTimeline, sortRunsByCreatedAt } from "./runs-page.lib.js";
import { RunsPageCard } from "./runs-page-card.js";

export function RunsPage({ core }: { core: OperatorCore }) {
  const runsState = useOperatorStore(core.runsStore);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());

  const runs = useMemo(
    () => sortRunsByCreatedAt(Object.values(runsState.runsById)),
    [runsState.runsById],
  );

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
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Runs</h1>

      {runs.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No runs yet"
          description="Runs appear here when agents start executing."
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
