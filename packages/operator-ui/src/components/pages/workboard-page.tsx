import type {
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
  OperatorCore,
} from "@tyrum/operator-core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import {
  WORK_ITEM_STATUSES,
  groupWorkItemsByStatus,
  selectTasksForSelectedWorkItem,
  shouldProcessWorkStateKvUpdate,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
  type WorkStateKvEntry,
} from "../workboard/workboard-store.js";

export type WorkBoardPageProps = {
  core: OperatorCore;
};

const STATUS_LABELS: Record<(typeof WORK_ITEM_STATUSES)[number], string> = {
  backlog: "Backlog",
  ready: "Ready",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const DEFAULT_SCOPE = {
  tenant_id: "default",
  agent_id: "default",
  workspace_id: "default",
} as const;

function makeAgentScope(): WorkStateKVScope {
  return { kind: "agent", ...DEFAULT_SCOPE };
}

function makeWorkItemScope(workItemId: string): WorkStateKVScope {
  return { kind: "work_item", ...DEFAULT_SCOPE, work_item_id: workItemId };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</div>
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="text-sm text-fg-muted">{children}</div>;
}

function DetailListSection<T>({
  title,
  items,
  empty,
  renderItem,
}: {
  title: string;
  items: readonly T[];
  empty: string;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? <EmptyState>{empty}</EmptyState> : <div className="grid gap-2">{items.map(renderItem)}</div>}
    </Section>
  );
}

function KvSection({ title, entries }: { title: string; entries: readonly WorkStateKvEntry[] }) {
  return (
    <Section title={title}>
      {entries.length === 0 ? (
        <EmptyState>No entries.</EmptyState>
      ) : (
        <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
          {entries.map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`).join("\n")}
        </pre>
      )}
    </Section>
  );
}

function WorkItemColumn({
  status,
  items,
  selectedWorkItemId,
  onSelect,
}: {
  status: (typeof WORK_ITEM_STATUSES)[number];
  items: readonly WorkItem[];
  selectedWorkItemId: string | null;
  onSelect: (workItemId: string) => void;
}) {
  return (
    <Card className="w-64 shrink-0">
      <CardContent className="grid gap-3 pt-6">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-fg">{STATUS_LABELS[status]}</span>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <EmptyState>No items</EmptyState>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => {
              const active = item.work_item_id === selectedWorkItemId;
              return (
                <div
                  key={item.work_item_id}
                  className={[
                    "cursor-pointer rounded-lg border p-3 transition-colors",
                    active ? "border-primary bg-primary-dim" : "border-border bg-bg-subtle hover:bg-bg",
                  ].join(" ")}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(item.work_item_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelect(item.work_item_id);
                  }}
                >
                  <div className="text-sm font-semibold leading-snug text-fg">{item.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted"><span>{item.kind}</span><span>prio {item.priority}</span></div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span><span className="text-fg-muted">id</span> <span className="font-mono">{item.work_item_id.slice(0, 8)}</span></span>
                    {item.last_active_at ? <span>active {new Date(item.last_active_at).toLocaleString()}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkBoardPage({ core }: WorkBoardPageProps) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const workboard = useOperatorStore(core.workboardStore);

  const selectedIdRef = useRef<string | null>(null);

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [drilldownBusy, setDrilldownBusy] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<WorkItem["status"] | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [artifacts, setArtifacts] = useState<WorkArtifact[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [signals, setSignals] = useState<WorkSignal[]>([]);
  const [agentKvEntries, setAgentKvEntries] = useState<WorkStateKvEntry[]>([]);
  const [workItemKvEntries, setWorkItemKvEntries] = useState<WorkStateKvEntry[]>([]);

  useEffect(() => {
    selectedIdRef.current = selectedWorkItemId;
  }, [selectedWorkItemId]);

  const grouped = useMemo(() => groupWorkItemsByStatus(workboard.items), [workboard.items]);

  useEffect(() => {
    if (!selectedWorkItemId) return;
    const item = workboard.items.find((entry) => entry.work_item_id === selectedWorkItemId);
    if (!item) return;
    setSelectedItem((prev) => {
      if (!prev) return prev;
      return prev.work_item_id === item.work_item_id ? item : prev;
    });
  }, [selectedWorkItemId, workboard.items]);

  const reconnect = useCallback(() => {
    core.disconnect();
    core.connect();
  }, [core]);

  const transitionSelected = useCallback(
    async (status: WorkItem["status"], reason: string): Promise<void> => {
      if (!isConnected) return;
      if (!selectedWorkItemId) return;

      setTransitionTarget(status);
      setDrilldownError(null);
      try {
        const res = await core.ws.workTransition({
          ...DEFAULT_SCOPE,
          work_item_id: selectedWorkItemId,
          status,
          reason,
        });
        core.workboardStore.upsertWorkItem(res.item);

        setSelectedItem((prev: WorkItem | null) => {
          if (selectedIdRef.current !== res.item.work_item_id) return prev;
          return res.item;
        });
      } catch (error) {
        setDrilldownError(formatErrorMessage(error));
      } finally {
        setTransitionTarget(null);
      }
    },
    [core.ws, core.workboardStore, isConnected, selectedWorkItemId],
  );

  useEffect(() => {
    if (!isConnected) return;

    let disposed = false;

    const onWorkArtifactCreated = (event: { payload: { artifact: WorkArtifact } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId) return;
      if (event.payload.artifact.work_item_id !== selectedId) return;
      setArtifacts((prev) => upsertWorkArtifact(prev, event.payload.artifact));
    };

    const onWorkDecisionCreated = (event: { payload: { decision: DecisionRecord } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId) return;
      if (event.payload.decision.work_item_id !== selectedId) return;
      setDecisions((prev) => upsertWorkDecision(prev, event.payload.decision));
    };

    const onWorkSignalUpsert = (event: { payload: { signal: WorkSignal } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId) return;
      if (event.payload.signal.work_item_id !== selectedId) return;
      setSignals((prev) => upsertWorkSignal(prev, event.payload.signal));
    };

    const onWorkSignalFired = (event: { payload: { signal_id: string } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId) return;
      void core.ws
        .workSignalGet({ ...DEFAULT_SCOPE, signal_id: event.payload.signal_id })
        .then((res) => {
          if (disposed) return;
          if (res.signal.work_item_id !== selectedIdRef.current) return;
          setSignals((prev) => upsertWorkSignal(prev, res.signal));
        })
        .catch(() => {});
    };

    const onWorkStateKvUpdated = (event: { payload: { scope: WorkStateKVScope; key: string } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      const scope = event.payload.scope;
      if (!shouldProcessWorkStateKvUpdate(scope, selectedId)) return;
      void core.ws
        .workStateKvGet({ scope, key: event.payload.key })
        .then((res) => {
          if (disposed) return;
          if (!shouldProcessWorkStateKvUpdate(scope, selectedIdRef.current)) return;
          const entry = res.entry;
          if (!entry) return;
          if (scope.kind === "agent") {
            setAgentKvEntries((prev) => upsertWorkStateKvEntry(prev, entry));
          } else {
            setWorkItemKvEntries((prev) => upsertWorkStateKvEntry(prev, entry));
          }
        })
        .catch(() => {});
    };

    core.ws.on("work.artifact.created", onWorkArtifactCreated);
    core.ws.on("work.decision.created", onWorkDecisionCreated);
    core.ws.on("work.signal.created", onWorkSignalUpsert);
    core.ws.on("work.signal.updated", onWorkSignalUpsert);
    core.ws.on("work.signal.fired", onWorkSignalFired);
    core.ws.on("work.state_kv.updated", onWorkStateKvUpdated);

    return () => {
      disposed = true;
      core.ws.off("work.artifact.created", onWorkArtifactCreated);
      core.ws.off("work.decision.created", onWorkDecisionCreated);
      core.ws.off("work.signal.created", onWorkSignalUpsert);
      core.ws.off("work.signal.updated", onWorkSignalUpsert);
      core.ws.off("work.signal.fired", onWorkSignalFired);
      core.ws.off("work.state_kv.updated", onWorkStateKvUpdated);
    };
  }, [core.ws, isConnected]);

  useEffect(() => {
    if (!isConnected || !selectedWorkItemId) {
      setSelectedItem(null);
      setArtifacts([]);
      setDecisions([]);
      setSignals([]);
      setAgentKvEntries([]);
      setWorkItemKvEntries([]);
      setDrilldownBusy(false);
      setDrilldownError(null);
      return;
    }

    let cancelled = false;
    setDrilldownBusy(true);
    setDrilldownError(null);

    const load = async (): Promise<void> => {
      try {
        const [workItemRes, artifactsRes, decisionsRes, signalsRes, agentKvRes, workItemKvRes] =
          await Promise.all([
            core.ws.workGet({ ...DEFAULT_SCOPE, work_item_id: selectedWorkItemId }),
            core.ws.workArtifactList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workDecisionList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workSignalList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workStateKvList({ scope: makeAgentScope() }),
            core.ws.workStateKvList({ scope: makeWorkItemScope(selectedWorkItemId) }),
          ]);

        if (cancelled) return;
        setSelectedItem(workItemRes.item);
        setArtifacts(artifactsRes.artifacts);
        setDecisions(decisionsRes.decisions);
        setSignals(signalsRes.signals);
        setAgentKvEntries(agentKvRes.entries);
        setWorkItemKvEntries(workItemKvRes.entries);
      } catch (error) {
        if (cancelled) return;
        setDrilldownError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setDrilldownBusy(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [core.ws, isConnected, selectedWorkItemId]);

  const tasksForSelected = selectTasksForSelectedWorkItem(
    workboard.tasksByWorkItemId,
    selectedWorkItemId,
  );
  const taskList = useMemo(() => Object.values(tasksForSelected), [tasksForSelected]);

  const taskCounts = useMemo(() => {
    const counts = { leased: 0, running: 0, paused: 0, completed: 0 };
    for (const task of taskList) {
      counts[task.status] += 1;
    }
    return counts;
  }, [taskList]);

  const approvalBlockers = useMemo(
    () =>
      taskList.filter((task) => task.status === "paused" && typeof task.approval_id === "number"),
    [taskList],
  );

  const connectionDotVariant: StatusDotVariant =
    connection.status === "connected"
      ? "success"
      : connection.status === "connecting"
        ? "warning"
        : "neutral";

  const canMarkReadySelected = selectedItem?.status === "backlog";
  const canResumeSelected = selectedItem?.status === "blocked";
  const canCancelSelected =
    selectedItem?.status === "ready" ||
    selectedItem?.status === "doing" ||
    selectedItem?.status === "blocked";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Work</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <StatusDot variant={connectionDotVariant} pulse={connection.status === "connecting"} />
            {connection.status}
          </div>
          <Button variant="secondary" size="sm" onClick={reconnect}>
            Reconnect
          </Button>
        </div>
      </div>

      {!isConnected ? (
        <Alert
          variant="warning"
          title="Not connected"
          description="Connect to the gateway to use WorkBoard."
        />
      ) : null}

      {workboard.error ? (
        <Alert variant="error" title="WorkBoard error" description={workboard.error} />
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {WORK_ITEM_STATUSES.map((status) => (
          <WorkItemColumn
            key={status}
            status={status}
            items={grouped[status]}
            selectedWorkItemId={selectedWorkItemId}
            onSelect={setSelectedWorkItemId}
          />
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Drilldown</div>
          {!selectedWorkItemId ? (
            <div className="text-sm text-fg-muted">Select a WorkItem to inspect details.</div>
          ) : drilldownBusy ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : drilldownError ? (
            <Alert variant="error" title="Drilldown error" description={drilldownError} />
          ) : !selectedItem ? (
            <EmptyState>WorkItem not loaded.</EmptyState>
          ) : (
            <div className="grid gap-6">
              <Section title="WorkItem">
                <div className="text-sm font-semibold text-fg">{selectedItem.title}</div>
                <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                  <span>status <strong className="text-fg">{selectedItem.status}</strong></span>
                  <span>kind {selectedItem.kind}</span>
                  <span>priority {selectedItem.priority}</span>
                </div>
                {canMarkReadySelected || canResumeSelected || canCancelSelected ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {canMarkReadySelected ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void transitionSelected("ready", "operator triaged")}
                        disabled={transitionTarget !== null}
                        isLoading={transitionTarget === "ready"}
                      >
                        {transitionTarget === "ready" ? "Triaging…" : "Mark Ready"}
                      </Button>
                    ) : null}
                    {canResumeSelected ? (
                      <Button
                        size="sm"
                        onClick={() => void transitionSelected("doing", "operator resumed")}
                        disabled={transitionTarget !== null}
                        isLoading={transitionTarget === "doing"}
                      >
                        {transitionTarget === "doing" ? "Resuming…" : "Resume"}
                      </Button>
                    ) : null}
                    {canCancelSelected ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (!globalThis.confirm("Cancel this WorkItem?")) return;
                          void transitionSelected("cancelled", "operator cancelled");
                        }}
                        disabled={transitionTarget !== null}
                        isLoading={transitionTarget === "cancelled"}
                      >
                        {transitionTarget === "cancelled" ? "Cancelling…" : "Cancel"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <div className="font-mono text-xs text-fg-muted">{selectedItem.work_item_id}</div>
              </Section>

              <Section title="Timestamps">
                <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                  <span>created {new Date(selectedItem.created_at).toLocaleString()}</span>
                  {selectedItem.updated_at ? (
                    <span>updated {new Date(selectedItem.updated_at).toLocaleString()}</span>
                  ) : null}
                  {selectedItem.last_active_at ? (
                    <span>
                      last active {new Date(selectedItem.last_active_at).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              </Section>

              <Section title="Acceptance">
                <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
                  {selectedItem.acceptance === undefined
                    ? "—"
                    : JSON.stringify(selectedItem.acceptance, null, 2)}
                </pre>
              </Section>

              <Section title="Tasks">
                <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                  <span>running {taskCounts.running}</span>
                  <span>leased {taskCounts.leased}</span>
                  <span>paused {taskCounts.paused}</span>
                  <span>completed {taskCounts.completed}</span>
                </div>
                {taskList.length > 0 ? (
                  <div className="grid gap-2">
                    {taskList.map((task) => (
                      <div
                        key={task.task_id}
                        className="rounded-lg border border-border bg-bg-subtle p-3"
                      >
                        <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                          <span><strong className="text-fg">{task.status}</strong></span>
                          <span className="font-mono">{task.task_id}</span>
                          <span>{new Date(task.last_event_at).toLocaleString()}</span>
                        </div>
                        {(task.run_id ||
                          typeof task.approval_id === "number" ||
                          task.result_summary) && (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                            {task.run_id ? <span>run {task.run_id}</span> : null}
                            {typeof task.approval_id === "number" ? (
                              <span>approval {task.approval_id}</span>
                            ) : null}
                            {task.result_summary ? <span>result {task.result_summary}</span> : null}
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
                empty="No approval blockers."
                renderItem={(task) => (
                  <div key={task.task_id} className="rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                      <span>approval {task.approval_id}</span>
                      <span className="font-mono">{task.task_id}</span>
                    </div>
                  </div>
                )}
              />

              <DetailListSection
                title="Decisions"
                items={decisions}
                empty="No DecisionRecords."
                renderItem={(decision) => (
                  <div key={decision.decision_id} className="rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-sm font-semibold text-fg">{decision.question}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted"><span>chosen {decision.chosen}</span><span>{new Date(decision.created_at).toLocaleString()}</span></div>
                    <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">{decision.rationale_md}</pre>
                  </div>
                )}
              />

              <DetailListSection
                title="Artifacts"
                items={artifacts}
                empty="No WorkArtifacts."
                renderItem={(artifact) => (
                  <div key={artifact.artifact_id} className="rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="flex flex-wrap gap-2 text-xs text-fg-muted"><span className="font-semibold text-fg">{artifact.kind}</span><span>{new Date(artifact.created_at).toLocaleString()}</span></div>
                    <div className="mt-1 text-sm font-semibold text-fg">{artifact.title}</div>
                    {artifact.body_md ? <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">{artifact.body_md}</pre> : null}
                    {artifact.refs.length > 0 ? <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted"><span className="text-fg-muted">refs</span><span className="font-mono">{artifact.refs.join(", ")}</span></div> : null}
                    <div className="mt-2 font-mono text-xs text-fg-muted">{artifact.artifact_id}</div>
                  </div>
                )}
              />

              <DetailListSection
                title="Signals"
                items={signals}
                empty="No WorkSignals."
                renderItem={(signal) => (
                  <div key={signal.signal_id} className="rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                      <span className="font-semibold text-fg">{signal.trigger_kind}</span>
                      <span>status <strong className="text-fg">{signal.status}</strong></span>
                      <span>{new Date(signal.created_at).toLocaleString()}</span>
                      {signal.last_fired_at ? <span>last fired {new Date(signal.last_fired_at).toLocaleString()}</span> : null}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">{JSON.stringify(signal.trigger_spec_json, null, 2)}</pre>
                    <div className="mt-2 font-mono text-xs text-fg-muted">{signal.signal_id}</div>
                  </div>
                )}
              />

              <KvSection title="State KV (agent)" entries={agentKvEntries} />
              <KvSection title="State KV (work item)" entries={workItemKvEntries} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
