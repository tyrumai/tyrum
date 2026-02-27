import { TyrumClient } from "@tyrum/client";
import type {
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
} from "@tyrum/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
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
} from "../lib/workboard-store.js";
import {
  badge,
  btn,
  card,
  colors,
  fonts,
  heading,
  label,
  sectionTitle,
  statusDot,
} from "../theme.js";

type OperatorConnectionInfo = {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
};

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const headerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const boardScrollStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  overflowX: "auto",
  paddingBottom: 8,
};

const columnStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  background: colors.bgCard,
  padding: 12,
  minHeight: 140,
  width: 260,
  flex: "0 0 auto",
};

const columnTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 700,
  color: colors.fg,
};

function workItemCardStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? colors.primary : colors.border}`,
    borderRadius: 8,
    padding: 10,
    background: active ? colors.primaryDim : colors.bgSubtle,
    cursor: "pointer",
    marginBottom: 8,
  };
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
  color: colors.fg,
  lineHeight: 1.25,
};

const cardMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: colors.fgMuted,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const monospaceStyle: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 12,
  color: colors.fg,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
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

export function WorkBoard() {
  const api = window.tyrumDesktop;
  const clientRef = useRef<TyrumClient | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const [connectionInfo, setConnectionInfo] = useState<OperatorConnectionInfo | null>(null);
  const [connectNonce, setConnectNonce] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "connected" | "disconnected"
  >("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);

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

  useEffect(() => {
    selectedIdRef.current = selectedWorkItemId;
  }, [selectedWorkItemId]);

  const grouped = useMemo(() => groupWorkItemsByStatus(items), [items]);

  const reconnect = useCallback(() => {
    setConnectNonce((n) => n + 1);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    setConnectionError(null);
    try {
      const res = await client.workList({ ...DEFAULT_SCOPE, limit: 200 });
      setItems(res.items);
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("work.list failed: unsupported_request")) {
        setConnectionError("WorkBoard is not supported by this gateway (database not configured).");
        setItems([]);
        return;
      }
      setConnectionError(message);
    }
  }, []);

  const transitionSelected = useCallback(
    async (status: WorkItem["status"], reason: string): Promise<void> => {
      if (connectionStatus !== "connected") return;
      const client = clientRef.current;
      if (!client) return;
      if (!selectedWorkItemId) return;

      setTransitionTarget(status);
      setDrilldownError(null);
      try {
        const res = await client.workTransition({
          ...DEFAULT_SCOPE,
          work_item_id: selectedWorkItemId,
          status,
          reason,
        });

        setItems((prev) => upsertWorkItem(prev, res.item));
        setSelectedItem((prev) => {
          if (selectedIdRef.current !== res.item.work_item_id) return prev;
          return res.item;
        });
      } catch (error) {
        setDrilldownError(toErrorMessage(error));
      } finally {
        setTransitionTarget(null);
      }
    },
    [connectionStatus, selectedWorkItemId],
  );

  useEffect(() => {
    if (!api) {
      setConnectionError("Desktop API not available.");
      return;
    }

    let disposed = false;
    clientRef.current?.disconnect();
    clientRef.current = null;

    setConnectionStatus("connecting");
    setConnectionError(null);
    setItems([]);
    setTasksByWorkItemId({});
    setSelectedItem(null);
    setArtifacts([]);
    setDecisions([]);
    setSignals([]);
    setAgentKvEntries([]);
    setWorkItemKvEntries([]);
    setDrilldownBusy(false);
    setDrilldownError(null);
    setTransitionTarget(null);

    let wsClient: TyrumClient | null = null;

    let onConnected: (() => void) | null = null;
    let onDisconnected: (() => void) | null = null;
    let onTransportError: ((event: { message: string }) => void) | null = null;
    let onWorkItemEvent: ((event: { payload: { item: WorkItem } }) => void) | null = null;
    let onWorkTaskEvent: ((event: Parameters<typeof applyWorkTaskEvent>[1]) => void) | null = null;
    let onWorkArtifactCreated: ((event: { payload: { artifact: WorkArtifact } }) => void) | null =
      null;
    let onWorkDecisionCreated: ((event: { payload: { decision: DecisionRecord } }) => void) | null =
      null;
    let onWorkSignalUpsert: ((event: { payload: { signal: WorkSignal } }) => void) | null = null;
    let onWorkSignalFired:
      | ((event: { payload: { signal_id: string }; occurred_at: string }) => void)
      | null = null;
    let onWorkStateKvUpdated:
      | ((event: { payload: { scope: WorkStateKVScope; key: string } }) => void)
      | null = null;

    void (async () => {
      try {
        const info = (await api.gateway.getOperatorConnection()) as OperatorConnectionInfo;
        if (disposed) return;
        setConnectionInfo(info);

        wsClient = new TyrumClient({
          url: info.wsUrl,
          token: info.token,
          capabilities: [],
          reconnect: true,
          maxReconnectDelay: 10_000,
        });
        clientRef.current = wsClient;

        onConnected = () => {
          if (disposed) return;
          setConnectionStatus("connected");
          void refresh();
        };

        onDisconnected = () => {
          if (disposed) return;
          setConnectionStatus("disconnected");
        };

        onTransportError = (event) => {
          if (disposed) return;
          setConnectionError(event.message);
        };

        onWorkItemEvent = (event) => {
          if (disposed) return;
          setItems((prev) => upsertWorkItem(prev, event.payload.item));
          setSelectedItem((prev) => {
            if (!prev) return prev;
            return prev.work_item_id === event.payload.item.work_item_id
              ? event.payload.item
              : prev;
          });
        };

        onWorkTaskEvent = (event) => {
          if (disposed) return;
          setTasksByWorkItemId((prev) => applyWorkTaskEvent(prev, event));
        };

        onWorkArtifactCreated = (event) => {
          if (disposed) return;
          const selectedId = selectedIdRef.current;
          if (!selectedId) return;
          if (event.payload.artifact.work_item_id !== selectedId) return;
          setArtifacts((prev) => upsertWorkArtifact(prev, event.payload.artifact));
        };

        onWorkDecisionCreated = (event) => {
          if (disposed) return;
          const selectedId = selectedIdRef.current;
          if (!selectedId) return;
          if (event.payload.decision.work_item_id !== selectedId) return;
          setDecisions((prev) => upsertWorkDecision(prev, event.payload.decision));
        };

        onWorkSignalUpsert = (event) => {
          if (disposed) return;
          const selectedId = selectedIdRef.current;
          if (!selectedId) return;
          if (event.payload.signal.work_item_id !== selectedId) return;
          setSignals((prev) => upsertWorkSignal(prev, event.payload.signal));
        };

        onWorkSignalFired = (event) => {
          if (disposed) return;
          const selectedId = selectedIdRef.current;
          if (!selectedId) return;
          const client = wsClient;
          if (!client) return;
          void client
            .workSignalGet({ ...DEFAULT_SCOPE, signal_id: event.payload.signal_id })
            .then((res) => {
              if (disposed) return;
              if (res.signal.work_item_id !== selectedIdRef.current) return;
              setSignals((prev) => upsertWorkSignal(prev, res.signal));
            })
            .catch(() => {});
        };

        onWorkStateKvUpdated = (event) => {
          if (disposed) return;
          const selectedId = selectedIdRef.current;
          const scope = event.payload.scope;

          if (!shouldProcessWorkStateKvUpdate(scope, selectedId)) return;

          const client = wsClient;
          if (!client) return;
          void client
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

        wsClient.on("connected", onConnected);
        wsClient.on("disconnected", onDisconnected);
        wsClient.on("transport_error", onTransportError);

        wsClient.on("work.item.created", onWorkItemEvent);
        wsClient.on("work.item.updated", onWorkItemEvent);
        wsClient.on("work.item.blocked", onWorkItemEvent);
        wsClient.on("work.item.completed", onWorkItemEvent);
        wsClient.on("work.item.failed", onWorkItemEvent);
        wsClient.on("work.item.cancelled", onWorkItemEvent);

        wsClient.on("work.task.leased", onWorkTaskEvent);
        wsClient.on("work.task.started", onWorkTaskEvent);
        wsClient.on("work.task.paused", onWorkTaskEvent);
        wsClient.on("work.task.completed", onWorkTaskEvent);

        wsClient.on("work.artifact.created", onWorkArtifactCreated);
        wsClient.on("work.decision.created", onWorkDecisionCreated);
        wsClient.on("work.signal.created", onWorkSignalUpsert);
        wsClient.on("work.signal.updated", onWorkSignalUpsert);
        wsClient.on("work.signal.fired", onWorkSignalFired);
        wsClient.on("work.state_kv.updated", onWorkStateKvUpdated);

        wsClient.connect();
      } catch (error) {
        if (disposed) return;
        setConnectionStatus("disconnected");
        setConnectionError(toErrorMessage(error));
      }
    })();

    return () => {
      disposed = true;
      if (!wsClient) return;

      if (onConnected) wsClient.off("connected", onConnected);
      if (onDisconnected) wsClient.off("disconnected", onDisconnected);
      if (onTransportError) wsClient.off("transport_error", onTransportError);

      if (onWorkItemEvent) {
        wsClient.off("work.item.created", onWorkItemEvent);
        wsClient.off("work.item.updated", onWorkItemEvent);
        wsClient.off("work.item.blocked", onWorkItemEvent);
        wsClient.off("work.item.completed", onWorkItemEvent);
        wsClient.off("work.item.failed", onWorkItemEvent);
        wsClient.off("work.item.cancelled", onWorkItemEvent);
      }

      if (onWorkTaskEvent) {
        wsClient.off("work.task.leased", onWorkTaskEvent);
        wsClient.off("work.task.started", onWorkTaskEvent);
        wsClient.off("work.task.paused", onWorkTaskEvent);
        wsClient.off("work.task.completed", onWorkTaskEvent);
      }

      if (onWorkArtifactCreated) wsClient.off("work.artifact.created", onWorkArtifactCreated);
      if (onWorkDecisionCreated) wsClient.off("work.decision.created", onWorkDecisionCreated);
      if (onWorkSignalUpsert) {
        wsClient.off("work.signal.created", onWorkSignalUpsert);
        wsClient.off("work.signal.updated", onWorkSignalUpsert);
      }
      if (onWorkSignalFired) wsClient.off("work.signal.fired", onWorkSignalFired);
      if (onWorkStateKvUpdated) wsClient.off("work.state_kv.updated", onWorkStateKvUpdated);

      wsClient.disconnect();

      if (clientRef.current === wsClient) {
        clientRef.current = null;
      }
    };
  }, [api, connectNonce, refresh]);

  useEffect(() => {
    const client = clientRef.current;
    if (connectionStatus !== "connected" || !client || !selectedWorkItemId) {
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
            client.workGet({ ...DEFAULT_SCOPE, work_item_id: selectedWorkItemId }),
            client.workArtifactList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            client.workDecisionList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            client.workSignalList({
              ...DEFAULT_SCOPE,
              work_item_id: selectedWorkItemId,
              limit: 200,
            }),
            client.workStateKvList({ scope: makeAgentScope() }),
            client.workStateKvList({ scope: makeWorkItemScope(selectedWorkItemId) }),
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
        setDrilldownError(toErrorMessage(error));
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
  }, [connectionStatus, selectedWorkItemId]);

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

  const connectionDotColor =
    connectionStatus === "connected"
      ? colors.success
      : connectionStatus === "connecting"
        ? colors.warning
        : connectionStatus === "disconnected"
          ? colors.neutral
          : colors.neutral;

  const tlsPinWarning = connectionInfo?.tlsCertFingerprint256?.trim().length
    ? "TLS fingerprint pinning is configured, but pin verification is not enforced in the Desktop renderer."
    : null;

  const canMarkReadySelected = selectedItem?.status === "backlog";
  const canResumeSelected = selectedItem?.status === "blocked";
  const canCancelSelected =
    selectedItem?.status === "ready" ||
    selectedItem?.status === "doing" ||
    selectedItem?.status === "blocked";

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <h1 style={{ ...heading, marginBottom: 0 }}>Work</h1>
        <div style={headerActionsStyle}>
          <div style={{ fontSize: 13, color: colors.fgMuted }}>
            <span style={statusDot(connectionDotColor)} />
            {connectionStatus}
          </div>
          <button
            style={btn("secondary")}
            onClick={refresh}
            disabled={connectionStatus !== "connected"}
          >
            Refresh
          </button>
          <button style={btn("secondary")} onClick={reconnect}>
            Reconnect
          </button>
        </div>
      </div>

      {tlsPinWarning && (
        <div style={{ ...card, marginBottom: 0, borderColor: colors.warning }}>
          <div style={{ ...label, marginBottom: 6 }}>TLS</div>
          <div style={{ fontSize: 13, color: colors.fg }}>{tlsPinWarning}</div>
        </div>
      )}

      {connectionError && (
        <div style={{ ...card, marginBottom: 0, borderColor: colors.error }}>
          <div style={{ ...label, marginBottom: 6 }}>Connection error</div>
          <div style={{ fontSize: 13, color: colors.error }}>{connectionError}</div>
        </div>
      )}

      <div style={boardScrollStyle}>
        {WORK_ITEM_STATUSES.map((status) => {
          const columnItems = grouped[status];
          return (
            <section key={status} style={columnStyle}>
              <div style={columnTitleStyle}>
                <span>{STATUS_LABELS[status]}</span>
                <span style={{ ...badge, margin: 0 }}>{columnItems.length}</span>
              </div>
              {columnItems.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No items</div>
              ) : (
                columnItems.map((item) => (
                  <div
                    key={item.work_item_id}
                    style={workItemCardStyle(item.work_item_id === selectedWorkItemId)}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedWorkItemId(item.work_item_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        setSelectedWorkItemId(item.work_item_id);
                    }}
                  >
                    <div style={cardTitleStyle}>{item.title}</div>
                    <div style={cardMetaStyle}>
                      <span>{item.kind}</span>
                      <span>prio {item.priority}</span>
                    </div>
                    <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                      <span style={{ fontFamily: "inherit" }}>
                        <span style={{ color: colors.fgMuted }}>id</span>{" "}
                        <span style={{ fontFamily: fonts.mono }}>
                          {item.work_item_id.slice(0, 8)}
                        </span>
                      </span>
                      {item.last_active_at && (
                        <span>active {new Date(item.last_active_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          );
        })}
      </div>

      <div style={card}>
        <div style={sectionTitle}>Drilldown</div>
        {!selectedWorkItemId ? (
          <div style={{ fontSize: 13, color: colors.fgMuted }}>
            Select a WorkItem to inspect details.
          </div>
        ) : drilldownBusy ? (
          <div style={{ fontSize: 13, color: colors.fgMuted }}>Loading…</div>
        ) : drilldownError ? (
          <div style={{ fontSize: 13, color: colors.error }}>{drilldownError}</div>
        ) : !selectedItem ? (
          <div style={{ fontSize: 13, color: colors.fgMuted }}>WorkItem not loaded.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={label}>WorkItem</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.fg }}>
                {selectedItem.title}
              </div>
              <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                <span>
                  status <strong style={{ color: colors.fg }}>{selectedItem.status}</strong>
                </span>
                <span>kind {selectedItem.kind}</span>
                <span>priority {selectedItem.priority}</span>
              </div>
              {(canMarkReadySelected || canResumeSelected || canCancelSelected) && (
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  {canMarkReadySelected && (
                    <button
                      style={btn("secondary")}
                      onClick={() => void transitionSelected("ready", "operator triaged")}
                      disabled={transitionTarget !== null}
                    >
                      {transitionTarget === "ready" ? "Triaging…" : "Mark Ready"}
                    </button>
                  )}
                  {canResumeSelected && (
                    <button
                      style={btn("primary")}
                      onClick={() => void transitionSelected("doing", "operator resumed")}
                      disabled={transitionTarget !== null}
                    >
                      {transitionTarget === "doing" ? "Resuming…" : "Resume"}
                    </button>
                  )}
                  {canCancelSelected && (
                    <button
                      style={btn("danger")}
                      onClick={() => {
                        if (!window.confirm("Cancel this WorkItem?")) return;
                        void transitionSelected("cancelled", "operator cancelled");
                      }}
                      disabled={transitionTarget !== null}
                    >
                      {transitionTarget === "cancelled" ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              )}
              <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                <span style={{ fontFamily: fonts.mono }}>{selectedItem.work_item_id}</span>
              </div>
            </div>

            <div>
              <div style={label}>Timestamps</div>
              <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                <span>created {new Date(selectedItem.created_at).toLocaleString()}</span>
                {selectedItem.updated_at && (
                  <span>updated {new Date(selectedItem.updated_at).toLocaleString()}</span>
                )}
                {selectedItem.last_active_at && (
                  <span>last active {new Date(selectedItem.last_active_at).toLocaleString()}</span>
                )}
              </div>
            </div>

            <div>
              <div style={label}>Acceptance</div>
              <pre style={monospaceStyle}>
                {selectedItem.acceptance === undefined
                  ? "—"
                  : JSON.stringify(selectedItem.acceptance, null, 2)}
              </pre>
            </div>

            <div>
              <div style={label}>Tasks</div>
              <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                <span>running {taskCounts.running}</span>
                <span>leased {taskCounts.leased}</span>
                <span>paused {taskCounts.paused}</span>
                <span>completed {taskCounts.completed}</span>
              </div>
              {taskList.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {taskList.map((task) => (
                    <div
                      key={task.task_id}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.bgSubtle,
                      }}
                    >
                      <div style={{ ...cardMetaStyle, marginTop: 0 }}>
                        <span>
                          <strong style={{ color: colors.fg }}>{task.status}</strong>
                        </span>
                        <span style={{ fontFamily: fonts.mono }}>{task.task_id}</span>
                        <span>{new Date(task.last_event_at).toLocaleString()}</span>
                      </div>
                      {(task.run_id ||
                        typeof task.approval_id === "number" ||
                        task.result_summary) && (
                        <div style={{ ...cardMetaStyle, marginTop: 6 }}>
                          {task.run_id && <span>run {task.run_id}</span>}
                          {typeof task.approval_id === "number" && (
                            <span>approval {task.approval_id}</span>
                          )}
                          {task.result_summary && <span>result {task.result_summary}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>Blockers</div>
              {approvalBlockers.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No approval blockers.</div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {approvalBlockers.map((task) => (
                    <div
                      key={task.task_id}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.bgSubtle,
                      }}
                    >
                      <div style={{ ...cardMetaStyle, marginTop: 0 }}>
                        <span>approval {task.approval_id}</span>
                        <span style={{ fontFamily: fonts.mono }}>{task.task_id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>Decisions</div>
              {decisions.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No DecisionRecords.</div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {decisions.map((decision) => (
                    <div
                      key={decision.decision_id}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.bgSubtle,
                      }}
                    >
                      <div style={cardTitleStyle}>{decision.question}</div>
                      <div style={{ ...cardMetaStyle, marginTop: 0 }}>
                        <span>chosen {decision.chosen}</span>
                        <span>{new Date(decision.created_at).toLocaleString()}</span>
                      </div>
                      <pre style={{ ...monospaceStyle, marginTop: 8 }}>{decision.rationale_md}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>Artifacts</div>
              {artifacts.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No WorkArtifacts.</div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {artifacts.map((artifact) => (
                    <div
                      key={artifact.artifact_id}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.bgSubtle,
                      }}
                    >
                      <div style={{ ...cardMetaStyle, marginTop: 0 }}>
                        <span style={{ fontWeight: 700, color: colors.fg }}>{artifact.kind}</span>
                        <span>{new Date(artifact.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ ...cardTitleStyle, marginTop: 6 }}>{artifact.title}</div>
                      {artifact.body_md && <pre style={monospaceStyle}>{artifact.body_md}</pre>}
                      {artifact.refs.length > 0 && (
                        <div style={{ ...cardMetaStyle, marginTop: 8 }}>
                          <span style={{ color: colors.fgMuted }}>refs</span>
                          <span style={{ fontFamily: fonts.mono }}>{artifact.refs.join(", ")}</span>
                        </div>
                      )}
                      <div style={{ ...cardMetaStyle, marginTop: 8 }}>
                        <span style={{ fontFamily: fonts.mono }}>{artifact.artifact_id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>Signals</div>
              {signals.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No WorkSignals.</div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {signals.map((signal) => (
                    <div
                      key={signal.signal_id}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.bgSubtle,
                      }}
                    >
                      <div style={{ ...cardMetaStyle, marginTop: 0 }}>
                        <span style={{ fontWeight: 700, color: colors.fg }}>
                          {signal.trigger_kind}
                        </span>
                        <span>
                          status <strong style={{ color: colors.fg }}>{signal.status}</strong>
                        </span>
                        <span>{new Date(signal.created_at).toLocaleString()}</span>
                        {signal.last_fired_at ? (
                          <span>last fired {new Date(signal.last_fired_at).toLocaleString()}</span>
                        ) : null}
                      </div>
                      <pre style={monospaceStyle}>
                        {JSON.stringify(signal.trigger_spec_json, null, 2)}
                      </pre>
                      <div style={{ ...cardMetaStyle, marginTop: 8 }}>
                        <span style={{ fontFamily: fonts.mono }}>{signal.signal_id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>State KV (agent)</div>
              {agentKvEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No entries.</div>
              ) : (
                <pre style={monospaceStyle}>
                  {agentKvEntries
                    .map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`)
                    .join("\n")}
                </pre>
              )}
            </div>

            <div>
              <div style={label}>State KV (work item)</div>
              {workItemKvEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: colors.fgMuted }}>No entries.</div>
              ) : (
                <pre style={monospaceStyle}>
                  {workItemKvEntries
                    .map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`)
                    .join("\n")}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
