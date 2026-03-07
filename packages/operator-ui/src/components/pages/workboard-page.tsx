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
import { Button } from "../ui/button.js";
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
import { WorkBoardDrilldown } from "./workboard-page-drilldown.js";
import { WorkItemColumn } from "./workboard-page.shared.js";

export type WorkBoardPageProps = {
  core: OperatorCore;
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
  );
}
