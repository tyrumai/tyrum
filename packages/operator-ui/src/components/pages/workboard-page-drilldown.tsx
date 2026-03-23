import type { DecisionRecord, WorkArtifact, WorkItem, WorkSignal } from "@tyrum/operator-app";
import { useEffect, useState } from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { LoadingState } from "../ui/loading-state.js";
import { StructuredValue } from "../ui/structured-value.js";
import type { WorkStateKvEntry, WorkTaskSummary } from "../workboard/workboard-store.js";
import { DetailListSection, InlineEmptyHint, KvSection, Section } from "./workboard-page.shared.js";

type TaskCounts = {
  leased: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type WorkBoardDrilldownProps = {
  selectedWorkItemId: string | null;
  drilldownBusy: boolean;
  drilldownError: string | null;
  selectedItem: WorkItem | null;
  pendingAction: WorkItem["status"] | "pause" | "resume" | "delete" | null;
  canMarkReadySelected: boolean;
  canPauseSelected: boolean;
  canResumeSelected: boolean;
  canEditSelected: boolean;
  canDeleteSelected: boolean;
  canCancelSelected: boolean;
  isReadOnlyLocked: boolean;
  onTransition: (status: WorkItem["status"], reason: string) => Promise<void>;
  onPause: (reason: string) => Promise<void>;
  onResume: (reason: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  taskCounts: TaskCounts;
  taskList: readonly WorkTaskSummary[];
  approvalBlockers: readonly WorkTaskSummary[];
  decisions: readonly DecisionRecord[];
  artifacts: readonly WorkArtifact[];
  signals: readonly WorkSignal[];
  agentKvEntries: readonly WorkStateKvEntry[];
  workItemKvEntries: readonly WorkStateKvEntry[];
};

export function WorkBoardDrilldown({
  selectedWorkItemId,
  drilldownBusy,
  drilldownError,
  selectedItem,
  pendingAction,
  canMarkReadySelected,
  canPauseSelected,
  canResumeSelected,
  canEditSelected,
  canDeleteSelected,
  canCancelSelected,
  isReadOnlyLocked,
  onTransition,
  onPause,
  onResume,
  onDelete,
  onEdit,
  taskCounts,
  taskList,
  approvalBlockers,
  decisions,
  artifacts,
  signals,
  agentKvEntries,
  workItemKvEntries,
}: WorkBoardDrilldownProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [drilldownErrorDismissed, setDrilldownErrorDismissed] = useState(false);

  useEffect(() => {
    setDrilldownErrorDismissed(false);
  }, [drilldownError]);

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Item Details</div>
        {!selectedWorkItemId ? (
          <div className="text-sm text-fg-muted">Select a WorkItem to inspect details.</div>
        ) : drilldownBusy ? (
          <LoadingState />
        ) : drilldownError && !drilldownErrorDismissed ? (
          <Alert
            variant="error"
            title="Item details error"
            description={drilldownError}
            onDismiss={() => setDrilldownErrorDismissed(true)}
          />
        ) : !selectedItem ? (
          <InlineEmptyHint>WorkItem not loaded.</InlineEmptyHint>
        ) : (
          <div className="grid gap-5">
            <Section title="WorkItem">
              <div className="break-words text-sm font-semibold text-fg [overflow-wrap:anywhere]">
                {selectedItem.title}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                <span>
                  status <strong className="text-fg">{selectedItem.status}</strong>
                </span>
                <span>kind {selectedItem.kind}</span>
                <span>priority {selectedItem.priority}</span>
              </div>
              {isReadOnlyLocked ? (
                <Alert
                  variant="info"
                  title="Read-only while leased"
                  description="This item is currently leased to an agent. Edit stays disabled while leased, but you can pause, cancel, or delete to stop the active agent work."
                />
              ) : null}
              {canMarkReadySelected ||
              canPauseSelected ||
              canResumeSelected ||
              canEditSelected ||
              canDeleteSelected ||
              canCancelSelected ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {canMarkReadySelected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onTransition("ready", "operator triaged")}
                      disabled={pendingAction !== null}
                      isLoading={pendingAction === "ready"}
                    >
                      {pendingAction === "ready" ? "Triaging…" : "Mark Ready"}
                    </Button>
                  ) : null}
                  {canPauseSelected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onPause("operator paused work item")}
                      disabled={pendingAction !== null}
                      isLoading={pendingAction === "pause"}
                    >
                      {pendingAction === "pause" ? "Pausing…" : "Pause"}
                    </Button>
                  ) : null}
                  {canResumeSelected ? (
                    <Button
                      size="sm"
                      onClick={() => void onResume("operator resumed work item")}
                      disabled={pendingAction !== null}
                      isLoading={pendingAction === "resume"}
                    >
                      {pendingAction === "resume" ? "Resuming…" : "Resume"}
                    </Button>
                  ) : null}
                  {canEditSelected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onEdit}
                      disabled={pendingAction !== null || isReadOnlyLocked}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDeleteSelected ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteOpen(true)}
                      disabled={pendingAction !== null}
                      isLoading={pendingAction === "delete"}
                    >
                      {pendingAction === "delete" ? "Deleting…" : "Delete"}
                    </Button>
                  ) : null}
                  {canCancelSelected ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setCancelOpen(true)}
                      disabled={pendingAction !== null}
                      isLoading={pendingAction === "cancelled"}
                    >
                      {pendingAction === "cancelled" ? "Cancelling…" : "Cancel"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Section>

            <Section title="Timestamps" collapsible defaultOpen={false}>
              <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                <span>created {new Date(selectedItem.created_at).toLocaleString()}</span>
                {selectedItem.updated_at ? (
                  <span>updated {new Date(selectedItem.updated_at).toLocaleString()}</span>
                ) : null}
                {selectedItem.last_active_at ? (
                  <span>last active {new Date(selectedItem.last_active_at).toLocaleString()}</span>
                ) : null}
              </div>
            </Section>

            <Section title="Acceptance" collapsible defaultOpen={false}>
              {selectedItem.acceptance === undefined ? (
                <span className="text-sm text-fg-muted">—</span>
              ) : (
                <StructuredValue value={selectedItem.acceptance} />
              )}
            </Section>

            <Section title="Tasks" collapsible>
              <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                <span>running {taskCounts.running}</span>
                <span>leased {taskCounts.leased}</span>
                <span>paused {taskCounts.paused}</span>
                <span>completed {taskCounts.completed}</span>
                <span>failed {taskCounts.failed}</span>
                <span>cancelled {taskCounts.cancelled}</span>
              </div>
              {taskList.length > 0 ? (
                <div className="grid gap-2">
                  {taskList.map((task) => (
                    <div
                      key={task.task_id}
                      data-task-id={task.task_id}
                      className="rounded-lg border border-border bg-bg-subtle p-3"
                    >
                      <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                        <span>
                          <strong className="text-fg">{task.status}</strong>
                        </span>
                        <span>{new Date(task.last_event_at).toLocaleString()}</span>
                      </div>
                      {(task.pause_reason || task.pause_detail || task.result_summary) && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                          {task.pause_reason ? <span>pause {task.pause_reason}</span> : null}
                          {task.pause_detail ? (
                            <span className="break-words [overflow-wrap:anywhere]">
                              detail {task.pause_detail}
                            </span>
                          ) : null}
                          {task.result_summary ? (
                            <span className="break-words [overflow-wrap:anywhere]">
                              result {task.result_summary}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </Section>

            <DetailListSection
              title="Blockers"
              items={approvalBlockers}
              collapsible
              renderItem={(task) => (
                <div
                  key={task.task_id}
                  className="rounded-lg border border-border bg-bg-subtle p-3"
                >
                  <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>Blocked by approval</span>
                  </div>
                </div>
              )}
            />

            <DetailListSection
              title="Decisions"
              items={decisions}
              collapsible
              defaultOpen={false}
              renderItem={(decision) => (
                <div
                  key={decision.decision_id}
                  className="rounded-lg border border-border bg-bg-subtle p-3"
                >
                  <div className="text-sm font-semibold text-fg">{decision.question}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>chosen {decision.chosen}</span>
                    <span>{new Date(decision.created_at).toLocaleString()}</span>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-fg [overflow-wrap:anywhere]">
                    {decision.rationale_md}
                  </pre>
                </div>
              )}
            />

            <DetailListSection
              title="Artifacts"
              items={artifacts}
              collapsible
              defaultOpen={false}
              renderItem={(artifact) => (
                <div
                  key={artifact.artifact_id}
                  className="rounded-lg border border-border bg-bg-subtle p-3"
                >
                  <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span className="font-semibold text-fg">{artifact.kind}</span>
                    <span>{new Date(artifact.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-fg">{artifact.title}</div>
                  {artifact.body_md ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-fg [overflow-wrap:anywhere]">
                      {artifact.body_md}
                    </pre>
                  ) : null}
                  {artifact.refs.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                      <span className="text-fg-muted">refs</span>
                      <span className="font-mono break-all">{artifact.refs.join(", ")}</span>
                    </div>
                  ) : null}
                </div>
              )}
            />

            <DetailListSection
              title="Signals"
              items={signals}
              collapsible
              defaultOpen={false}
              renderItem={(signal) => (
                <div
                  key={signal.signal_id}
                  className="rounded-lg border border-border bg-bg-subtle p-3"
                >
                  <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span className="font-semibold text-fg">{signal.trigger_kind}</span>
                    <span>
                      status <strong className="text-fg">{signal.status}</strong>
                    </span>
                    <span>{new Date(signal.created_at).toLocaleString()}</span>
                    {signal.last_fired_at ? (
                      <span>last fired {new Date(signal.last_fired_at).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <StructuredValue value={signal.trigger_spec_json} />
                  </div>
                </div>
              )}
            />

            <KvSection
              title="State KV (agent)"
              entries={agentKvEntries}
              collapsible
              defaultOpen={false}
            />
            <KvSection
              title="State KV (work item)"
              entries={workItemKvEntries}
              collapsible
              defaultOpen={false}
            />
          </div>
        )}
        <ConfirmDangerDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title="Cancel this WorkItem?"
          description="This will cancel the WorkItem and interrupt any active leased agent or subagent work."
          confirmLabel="Cancel WorkItem"
          onConfirm={() => onTransition("cancelled", "operator cancelled")}
        />
        <ConfirmDangerDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete this WorkItem?"
          description="This permanently removes the WorkItem and interrupts any active leased agent or subagent work."
          confirmLabel="Delete WorkItem"
          onConfirm={onDelete}
        />
      </CardContent>
    </Card>
  );
}
