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
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { AppPageToolbar } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { ScrollArea } from "../ui/scroll-area.js";
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
import { WorkBoardDrilldown } from "./workboard-page-drilldown.js";
import { WorkboardToolbarActions } from "./workboard-page-scope-controls.js";
import { STATUS_LABELS, WorkStatusList, WorkStatusPanel } from "./workboard-page.shared.js";

export type WorkBoardPageProps = { core: OperatorCore };

const DESKTOP_BOARD_GRID_STYLE = {
  gridTemplateColumns: `repeat(${WORK_ITEM_STATUSES.length}, minmax(0, 1fr))`,
} as const;

const WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX = 1120;
const WORKBOARD_DESKTOP_CONTENT_WIDTH_PX = WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX + 40;
const DESKTOP_BOARD_MIN_WIDTH_STYLE = { minWidth: WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX } as const;

function makeAgentScope(scopeKeys: { agent_key: string; workspace_key: string }): WorkStateKVScope {
  return { kind: "agent", ...scopeKeys };
}

function makeWorkItemScope(
  scopeKeys: { agent_key: string; workspace_key: string },
  workItemId: string,
): WorkStateKVScope {
  return { kind: "work_item", ...scopeKeys, work_item_id: workItemId };
}

export function WorkBoardPage({ core }: WorkBoardPageProps) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const workboard = useOperatorStore(core.workboardStore);
  const currentScopeKeys = workboard.scopeKeys;
  const effectiveScopeKeys = useMemo(
    () => ({
      agent_key: currentScopeKeys.agent_key,
      workspace_key: "default",
    }),
    [currentScopeKeys.agent_key],
  );
  const desktopBoard = useAppShellMinWidth(WORKBOARD_DESKTOP_CONTENT_WIDTH_PX);

  const selectedIdRef = useRef<string | null>(null);

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<(typeof WORK_ITEM_STATUSES)[number]>(
    WORK_ITEM_STATUSES[0],
  );
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
    setSelectedWorkItemId(null);
  }, [effectiveScopeKeys.agent_key, effectiveScopeKeys.workspace_key]);

  useEffect(() => {
    if (currentScopeKeys.workspace_key === effectiveScopeKeys.workspace_key) {
      return;
    }
    core.workboardStore.setScopeKeys(effectiveScopeKeys);
    if (!isConnected) return;
    void core.workboardStore.refreshList();
  }, [core.workboardStore, currentScopeKeys.workspace_key, effectiveScopeKeys, isConnected]);

  useEffect(() => {
    selectedIdRef.current = selectedWorkItemId;
  }, [selectedWorkItemId]);

  const grouped = useMemo(() => groupWorkItemsByStatus(workboard.items), [workboard.items]);

  useEffect(() => {
    if (selectedItem) {
      setSelectedStatus(selectedItem.status);
      return;
    }
    if (grouped[selectedStatus].length > 0) return;
    const nextStatus = WORK_ITEM_STATUSES.find((status) => grouped[status].length > 0);
    if (nextStatus && nextStatus !== selectedStatus) {
      setSelectedStatus(nextStatus);
    }
  }, [grouped, selectedItem, selectedStatus]);

  useEffect(() => {
    if (!selectedWorkItemId) return;
    const item = workboard.items.find((entry) => entry.work_item_id === selectedWorkItemId);
    if (!item) return;
    setSelectedItem((prev) => {
      if (!prev) return prev;
      return prev.work_item_id === item.work_item_id ? item : prev;
    });
  }, [selectedWorkItemId, workboard.items]);

  const transitionSelected = useCallback(
    async (status: WorkItem["status"], reason: string): Promise<void> => {
      if (!isConnected) return;
      if (!selectedWorkItemId) return;

      setTransitionTarget(status);
      setDrilldownError(null);
      try {
        const res = await core.ws.workTransition({
          ...effectiveScopeKeys,
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
    [core.ws, core.workboardStore, effectiveScopeKeys, isConnected, selectedWorkItemId],
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
        .workSignalGet({ ...effectiveScopeKeys, signal_id: event.payload.signal_id })
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
  }, [core.ws, effectiveScopeKeys, isConnected]);

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
            core.ws.workGet({ ...effectiveScopeKeys, work_item_id: selectedWorkItemId }),
            core.ws.workArtifactList({
              ...effectiveScopeKeys,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workDecisionList({
              ...effectiveScopeKeys,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workSignalList({
              ...effectiveScopeKeys,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            core.ws.workStateKvList({ scope: makeAgentScope(effectiveScopeKeys) }),
            core.ws.workStateKvList({
              scope: makeWorkItemScope(effectiveScopeKeys, selectedWorkItemId),
            }),
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
  }, [core.ws, effectiveScopeKeys, isConnected, selectedWorkItemId]);

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

  const canMarkReadySelected = selectedItem?.status === "backlog";
  const canResumeSelected = selectedItem?.status === "blocked";
  const canCancelSelected =
    selectedItem?.status === "ready" ||
    selectedItem?.status === "doing" ||
    selectedItem?.status === "blocked";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <AppPageToolbar
        actions={
          <WorkboardToolbarActions
            core={core}
            isConnected={isConnected}
            scopeKeys={effectiveScopeKeys}
          />
        }
      />

      {desktopBoard ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div data-layout-content="" className="grid gap-4 px-4 py-4 md:px-5 md:py-5">
              {workboard.error ? (
                <Alert variant="error" title="WorkBoard error" description={workboard.error} />
              ) : null}

              <div
                data-testid="workboard-board"
                className="overflow-hidden rounded-lg border border-border bg-bg-card"
              >
                <div
                  data-testid="workboard-board-header"
                  className="grid border-b border-border bg-bg-subtle"
                  style={{ ...DESKTOP_BOARD_GRID_STYLE, ...DESKTOP_BOARD_MIN_WIDTH_STYLE }}
                >
                  {WORK_ITEM_STATUSES.map((status) => (
                    <div
                      key={status}
                      className="border-r border-border px-2.5 py-2.5 last:border-r-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-fg">
                          {STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs text-fg-muted">{grouped[status].length}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="grid"
                  style={{ ...DESKTOP_BOARD_GRID_STYLE, ...DESKTOP_BOARD_MIN_WIDTH_STYLE }}
                >
                  {WORK_ITEM_STATUSES.map((status) => (
                    <div
                      key={status}
                      data-testid={`workboard-column-${status}`}
                      className="min-h-80 border-r border-border p-2.5 align-top last:border-r-0"
                    >
                      <WorkStatusList
                        items={grouped[status]}
                        selectedWorkItemId={selectedWorkItemId}
                        onSelect={setSelectedWorkItemId}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg-subtle/20">
                <div className="flex h-12 items-center border-b border-border px-4">
                  <div className="text-sm font-medium text-fg">
                    {selectedItem ? "Work item details" : "Select a work item"}
                  </div>
                </div>
                <div className="p-4">
                  <WorkBoardDrilldown
                    selectedWorkItemId={selectedWorkItemId}
                    drilldownBusy={drilldownBusy}
                    drilldownError={drilldownError}
                    selectedItem={selectedItem}
                    transitionTarget={transitionTarget}
                    canMarkReadySelected={canMarkReadySelected}
                    canResumeSelected={canResumeSelected}
                    canCancelSelected={canCancelSelected}
                    onTransition={transitionSelected}
                    taskCounts={taskCounts}
                    taskList={taskList}
                    approvalBlockers={approvalBlockers}
                    decisions={decisions}
                    artifacts={artifacts}
                    signals={signals}
                    agentKvEntries={agentKvEntries}
                    workItemKvEntries={workItemKvEntries}
                  />
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      ) : null}
      {!desktopBoard ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div data-layout-content="" className="grid gap-4 px-4 py-4 md:px-5 md:py-5">
              {workboard.error ? (
                <Alert variant="error" title="WorkBoard error" description={workboard.error} />
              ) : null}

              <div className="grid gap-3">
                <div
                  className="grid gap-2 sm:grid-cols-2"
                  data-testid="workboard-status-selector"
                  role="tablist"
                  aria-label="Work statuses"
                >
                  {WORK_ITEM_STATUSES.map((status) => {
                    const active = status === selectedStatus;
                    return (
                      <button
                        key={status}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-testid={`workboard-status-${status}`}
                        className={[
                          "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                          active
                            ? "border-primary bg-bg text-fg"
                            : "border-border bg-bg hover:bg-bg-subtle",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedStatus(status);
                        }}
                      >
                        <span>{STATUS_LABELS[status]}</span>
                        <span className="text-xs text-fg-muted">{grouped[status].length}</span>
                      </button>
                    );
                  })}
                </div>

                <WorkStatusPanel
                  status={selectedStatus}
                  items={grouped[selectedStatus]}
                  selectedWorkItemId={selectedWorkItemId}
                  onSelect={setSelectedWorkItemId}
                />
              </div>

              <WorkBoardDrilldown
                selectedWorkItemId={selectedWorkItemId}
                drilldownBusy={drilldownBusy}
                drilldownError={drilldownError}
                selectedItem={selectedItem}
                transitionTarget={transitionTarget}
                canMarkReadySelected={canMarkReadySelected}
                canResumeSelected={canResumeSelected}
                canCancelSelected={canCancelSelected}
                onTransition={transitionSelected}
                taskCounts={taskCounts}
                taskList={taskList}
                approvalBlockers={approvalBlockers}
                decisions={decisions}
                artifacts={artifacts}
                signals={signals}
                agentKvEntries={agentKvEntries}
                workItemKvEntries={workItemKvEntries}
              />
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
