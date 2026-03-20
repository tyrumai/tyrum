import type {
  DecisionRecord,
  OperatorCore,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
} from "@tyrum/operator-app";
import { useEffect, useRef, useState } from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  shouldProcessWorkStateKvUpdate,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
  type WorkStateKvEntry,
} from "../workboard/workboard-store.js";

type ScopeKeys = { agent_key: string; workspace_key: string };

function makeAgentScope(scopeKeys: ScopeKeys): WorkStateKVScope {
  return { kind: "agent", ...scopeKeys };
}

function makeWorkItemScope(scopeKeys: ScopeKeys, workItemId: string): WorkStateKVScope {
  return { kind: "work_item", ...scopeKeys, work_item_id: workItemId };
}

export function useWorkboardPageData(params: {
  core: OperatorCore;
  effectiveScopeKeys: ScopeKeys;
  isConnected: boolean;
  selectedWorkItemId: string | null;
  workboardItems: WorkItem[];
}) {
  const selectedIdRef = useRef<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [artifacts, setArtifacts] = useState<WorkArtifact[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [signals, setSignals] = useState<WorkSignal[]>([]);
  const [agentKvEntries, setAgentKvEntries] = useState<WorkStateKvEntry[]>([]);
  const [workItemKvEntries, setWorkItemKvEntries] = useState<WorkStateKvEntry[]>([]);
  const [drilldownBusy, setDrilldownBusy] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = params.selectedWorkItemId;
  }, [params.selectedWorkItemId]);

  useEffect(() => {
    if (!params.selectedWorkItemId) {
      return;
    }
    const item = params.workboardItems.find(
      (entry) => entry.work_item_id === params.selectedWorkItemId,
    );
    setSelectedItem(item ?? null);
  }, [params.selectedWorkItemId, params.workboardItems]);

  useEffect(() => {
    if (!params.isConnected) {
      return;
    }

    let disposed = false;

    const onWorkArtifactCreated = (event: { payload: { artifact: WorkArtifact } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId || event.payload.artifact.work_item_id !== selectedId) {
        return;
      }
      setArtifacts((prev) => upsertWorkArtifact(prev, event.payload.artifact));
    };

    const onWorkDecisionCreated = (event: { payload: { decision: DecisionRecord } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId || event.payload.decision.work_item_id !== selectedId) {
        return;
      }
      setDecisions((prev) => upsertWorkDecision(prev, event.payload.decision));
    };

    const onWorkSignalUpsert = (event: { payload: { signal: WorkSignal } }) => {
      if (disposed) return;
      const selectedId = selectedIdRef.current;
      if (!selectedId || event.payload.signal.work_item_id !== selectedId) {
        return;
      }
      setSignals((prev) => upsertWorkSignal(prev, event.payload.signal));
    };

    const onWorkSignalFired = (event: { payload: { signal_id: string } }) => {
      if (disposed || !selectedIdRef.current) {
        return;
      }
      void params.core.workboard
        .workSignalGet({
          ...params.effectiveScopeKeys,
          signal_id: event.payload.signal_id,
        })
        .then((res) => {
          if (disposed || res.signal.work_item_id !== selectedIdRef.current) {
            return;
          }
          setSignals((prev) => upsertWorkSignal(prev, res.signal));
        })
        .catch(() => undefined);
    };

    const onWorkStateKvUpdated = (event: { payload: { scope: WorkStateKVScope; key: string } }) => {
      if (disposed) return;
      const scope = event.payload.scope;
      if (!shouldProcessWorkStateKvUpdate(scope, selectedIdRef.current)) {
        return;
      }
      void params.core.workboard
        .workStateKvGet({ scope, key: event.payload.key })
        .then((res) => {
          if (disposed || !shouldProcessWorkStateKvUpdate(scope, selectedIdRef.current)) {
            return;
          }
          const entry = res.entry;
          if (!entry) {
            return;
          }
          if (scope.kind === "agent") {
            setAgentKvEntries((prev) => upsertWorkStateKvEntry(prev, entry));
            return;
          }
          setWorkItemKvEntries((prev) => upsertWorkStateKvEntry(prev, entry));
        })
        .catch(() => undefined);
    };

    params.core.workboard.on("work.artifact.created", onWorkArtifactCreated);
    params.core.workboard.on("work.decision.created", onWorkDecisionCreated);
    params.core.workboard.on("work.signal.created", onWorkSignalUpsert);
    params.core.workboard.on("work.signal.updated", onWorkSignalUpsert);
    params.core.workboard.on("work.signal.fired", onWorkSignalFired);
    params.core.workboard.on("work.state_kv.updated", onWorkStateKvUpdated);

    return () => {
      disposed = true;
      params.core.workboard.off("work.artifact.created", onWorkArtifactCreated);
      params.core.workboard.off("work.decision.created", onWorkDecisionCreated);
      params.core.workboard.off("work.signal.created", onWorkSignalUpsert);
      params.core.workboard.off("work.signal.updated", onWorkSignalUpsert);
      params.core.workboard.off("work.signal.fired", onWorkSignalFired);
      params.core.workboard.off("work.state_kv.updated", onWorkStateKvUpdated);
    };
  }, [params.core.workboard, params.effectiveScopeKeys, params.isConnected]);

  useEffect(() => {
    if (!params.isConnected || !params.selectedWorkItemId) {
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
    const workItemId = params.selectedWorkItemId;
    setDrilldownBusy(true);
    setDrilldownError(null);

    const load = async (): Promise<void> => {
      try {
        const [workItemRes, artifactsRes, decisionsRes, signalsRes, agentKvRes, workItemKvRes] =
          await Promise.all([
            params.core.workboard.workGet({
              ...params.effectiveScopeKeys,
              work_item_id: workItemId,
            }),
            params.core.workboard.workArtifactList({
              ...params.effectiveScopeKeys,
              work_item_id: workItemId,
              limit: 200,
            }),
            params.core.workboard.workDecisionList({
              ...params.effectiveScopeKeys,
              work_item_id: workItemId,
              limit: 200,
            }),
            params.core.workboard.workSignalList({
              ...params.effectiveScopeKeys,
              work_item_id: workItemId,
              limit: 200,
            }),
            params.core.workboard.workStateKvList({
              scope: makeAgentScope(params.effectiveScopeKeys),
            }),
            params.core.workboard.workStateKvList({
              scope: makeWorkItemScope(params.effectiveScopeKeys, workItemId),
            }),
          ]);

        if (cancelled) {
          return;
        }
        setSelectedItem(workItemRes.item);
        setArtifacts(artifactsRes.artifacts);
        setDecisions(decisionsRes.decisions);
        setSignals(signalsRes.signals);
        setAgentKvEntries(agentKvRes.entries);
        setWorkItemKvEntries(workItemKvRes.entries);
      } catch (error) {
        if (!cancelled) {
          setDrilldownError(formatErrorMessage(error));
        }
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
  }, [
    params.core.workboard,
    params.effectiveScopeKeys,
    params.isConnected,
    params.selectedWorkItemId,
  ]);

  return {
    selectedItem,
    setSelectedItem,
    artifacts,
    setArtifacts,
    decisions,
    setDecisions,
    signals,
    setSignals,
    agentKvEntries,
    setAgentKvEntries,
    workItemKvEntries,
    setWorkItemKvEntries,
    drilldownBusy,
    drilldownError,
    setDrilldownError,
  };
}
