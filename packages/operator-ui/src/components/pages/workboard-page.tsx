import type {
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
  OperatorCore,
} from "@tyrum/operator-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import {
  WORK_ITEM_STATUSES,
  applyWorkTaskEvent,
  groupWorkItemsByStatus,
  selectTasksForSelectedWorkItem,
  shouldProcessWorkStateKvUpdate,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkItem,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
  type WorkStateKvEntry,
  type WorkTasksByWorkItemId,
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

export function WorkBoardPage({ core }: WorkBoardPageProps) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";

  const selectedIdRef = useRef<string | null>(null);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [tasksByWorkItemId, setTasksByWorkItemId] = useState<WorkTasksByWorkItemId>({});

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

  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedWorkItemId;
  }, [selectedWorkItemId]);

  const grouped = useMemo(() => groupWorkItemsByStatus(items), [items]);

  const refresh = useCallback(async (): Promise<void> => {
    setConnectionError(null);
    try {
      const res = await core.ws.workList({ ...DEFAULT_SCOPE, limit: 200 });
      setItems(res.items);
    } catch (error) {
      const message = formatErrorMessage(error);
      if (message.includes("work.list failed: unsupported_request")) {
        setConnectionError("WorkBoard is not supported by this gateway (database not configured).");
        setItems([]);
        return;
      }
      setConnectionError(message);
    }
  }, [core.ws]);

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

        setItems((prev: WorkItem[]) => upsertWorkItem(prev, res.item));
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
    [core.ws, isConnected, selectedWorkItemId],
  );

  useEffect(() => {
    if (!isConnected) return;

    let disposed = false;

    setConnectionError(null);
    void refresh();

    const onWorkItemEvent = (event: { payload: { item: WorkItem } }) => {
      if (disposed) return;
      setItems((prev: WorkItem[]) => upsertWorkItem(prev, event.payload.item));
      setSelectedItem((prev: WorkItem | null) => {
        if (!prev) return prev;
        return prev.work_item_id === event.payload.item.work_item_id ? event.payload.item : prev;
      });
    };

    const onWorkTaskEvent = (event: Parameters<typeof applyWorkTaskEvent>[1]) => {
      if (disposed) return;
      setTasksByWorkItemId((prev) => applyWorkTaskEvent(prev, event));
    };

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

    core.ws.on("work.item.created", onWorkItemEvent);
    core.ws.on("work.item.updated", onWorkItemEvent);
    core.ws.on("work.item.blocked", onWorkItemEvent);
    core.ws.on("work.item.completed", onWorkItemEvent);
    core.ws.on("work.item.failed", onWorkItemEvent);
    core.ws.on("work.item.cancelled", onWorkItemEvent);

    core.ws.on("work.task.leased", onWorkTaskEvent);
    core.ws.on("work.task.started", onWorkTaskEvent);
    core.ws.on("work.task.paused", onWorkTaskEvent);
    core.ws.on("work.task.completed", onWorkTaskEvent);

    core.ws.on("work.artifact.created", onWorkArtifactCreated);
    core.ws.on("work.decision.created", onWorkDecisionCreated);
    core.ws.on("work.signal.created", onWorkSignalUpsert);
    core.ws.on("work.signal.updated", onWorkSignalUpsert);
    core.ws.on("work.signal.fired", onWorkSignalFired);
    core.ws.on("work.state_kv.updated", onWorkStateKvUpdated);

    return () => {
      disposed = true;
      core.ws.off("work.item.created", onWorkItemEvent);
      core.ws.off("work.item.updated", onWorkItemEvent);
      core.ws.off("work.item.blocked", onWorkItemEvent);
      core.ws.off("work.item.completed", onWorkItemEvent);
      core.ws.off("work.item.failed", onWorkItemEvent);
      core.ws.off("work.item.cancelled", onWorkItemEvent);

      core.ws.off("work.task.leased", onWorkTaskEvent);
      core.ws.off("work.task.started", onWorkTaskEvent);
      core.ws.off("work.task.paused", onWorkTaskEvent);
      core.ws.off("work.task.completed", onWorkTaskEvent);

      core.ws.off("work.artifact.created", onWorkArtifactCreated);
      core.ws.off("work.decision.created", onWorkDecisionCreated);
      core.ws.off("work.signal.created", onWorkSignalUpsert);
      core.ws.off("work.signal.updated", onWorkSignalUpsert);
      core.ws.off("work.signal.fired", onWorkSignalFired);
      core.ws.off("work.state_kv.updated", onWorkStateKvUpdated);
    };
  }, [core.ws, isConnected, refresh]);

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

  const tasksForSelected = selectTasksForSelectedWorkItem(tasksByWorkItemId, selectedWorkItemId);
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
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={!isConnected}
            title={!isConnected ? "Connect to refresh." : undefined}
          >
            Refresh
          </Button>
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

      {connectionError ? (
        <Alert variant="error" title="Connection error" description={connectionError} />
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {WORK_ITEM_STATUSES.map((status) => {
          const columnItems = grouped[status];
          return (
            <Card key={status} className="w-64 shrink-0">
              <CardContent className="grid gap-3 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-fg">{STATUS_LABELS[status]}</span>
                  <Badge variant="outline">{columnItems.length}</Badge>
                </div>

                {columnItems.length === 0 ? (
                  <div className="text-sm text-fg-muted">No items</div>
                ) : (
                  <div className="grid gap-2">
                    {columnItems.map((item) => {
                      const active = item.work_item_id === selectedWorkItemId;
                      return (
                        <div
                          key={item.work_item_id}
                          className={[
                            "cursor-pointer rounded-lg border p-3 transition-colors",
                            active
                              ? "border-primary bg-primary-dim"
                              : "border-border bg-bg-subtle hover:bg-bg",
                          ].join(" ")}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedWorkItemId(item.work_item_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              setSelectedWorkItemId(item.work_item_id);
                            }
                          }}
                        >
                          <div className="text-sm font-semibold leading-snug text-fg">
                            {item.title}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                            <span>{item.kind}</span>
                            <span>prio {item.priority}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                            <span>
                              <span className="text-fg-muted">id</span>{" "}
                              <span className="font-mono">{item.work_item_id.slice(0, 8)}</span>
                            </span>
                            {item.last_active_at ? (
                              <span>active {new Date(item.last_active_at).toLocaleString()}</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
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
            <div className="text-sm text-fg-muted">WorkItem not loaded.</div>
          ) : (
            <div className="grid gap-6">
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  WorkItem
                </div>
                <div className="text-sm font-semibold text-fg">{selectedItem.title}</div>
                <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                  <span>
                    status <strong className="text-fg">{selectedItem.status}</strong>
                  </span>
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
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Timestamps
                </div>
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
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Acceptance
                </div>
                <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
                  {selectedItem.acceptance === undefined
                    ? "—"
                    : JSON.stringify(selectedItem.acceptance, null, 2)}
                </pre>
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Tasks
                </div>
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
                          <span>
                            <strong className="text-fg">{task.status}</strong>
                          </span>
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
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Blockers
                </div>
                {approvalBlockers.length === 0 ? (
                  <div className="text-sm text-fg-muted">No approval blockers.</div>
                ) : (
                  <div className="grid gap-2">
                    {approvalBlockers.map((task) => (
                      <div
                        key={task.task_id}
                        className="rounded-lg border border-border bg-bg-subtle p-3"
                      >
                        <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
                          <span>approval {task.approval_id}</span>
                          <span className="font-mono">{task.task_id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Decisions
                </div>
                {decisions.length === 0 ? (
                  <div className="text-sm text-fg-muted">No DecisionRecords.</div>
                ) : (
                  <div className="grid gap-2">
                    {decisions.map((decision) => (
                      <div
                        key={decision.decision_id}
                        className="rounded-lg border border-border bg-bg-subtle p-3"
                      >
                        <div className="text-sm font-semibold text-fg">{decision.question}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                          <span>chosen {decision.chosen}</span>
                          <span>{new Date(decision.created_at).toLocaleString()}</span>
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">
                          {decision.rationale_md}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Artifacts
                </div>
                {artifacts.length === 0 ? (
                  <div className="text-sm text-fg-muted">No WorkArtifacts.</div>
                ) : (
                  <div className="grid gap-2">
                    {artifacts.map((artifact) => (
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
                          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">
                            {artifact.body_md}
                          </pre>
                        ) : null}
                        {artifact.refs.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                            <span className="text-fg-muted">refs</span>
                            <span className="font-mono">{artifact.refs.join(", ")}</span>
                          </div>
                        ) : null}
                        <div className="mt-2 font-mono text-xs text-fg-muted">
                          {artifact.artifact_id}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Signals
                </div>
                {signals.length === 0 ? (
                  <div className="text-sm text-fg-muted">No WorkSignals.</div>
                ) : (
                  <div className="grid gap-2">
                    {signals.map((signal) => (
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
                            <span>
                              last fired {new Date(signal.last_fired_at).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-fg">
                          {JSON.stringify(signal.trigger_spec_json, null, 2)}
                        </pre>
                        <div className="mt-2 font-mono text-xs text-fg-muted">
                          {signal.signal_id}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  State KV (agent)
                </div>
                {agentKvEntries.length === 0 ? (
                  <div className="text-sm text-fg-muted">No entries.</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
                    {agentKvEntries
                      .map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`)
                      .join("\n")}
                  </pre>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  State KV (work item)
                </div>
                {workItemKvEntries.length === 0 ? (
                  <div className="text-sm text-fg-muted">No entries.</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
                    {workItemKvEntries
                      .map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`)
                      .join("\n")}
                  </pre>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
