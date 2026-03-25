import type { OperatorCore } from "@tyrum/operator-app";
import type {
  Approval,
  TranscriptApprovalEvent,
  TranscriptConversationSummary,
} from "@tyrum/contracts";
import { WsSubagentCloseResult as WsSubagentCloseResultSchema } from "@tyrum/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import {
  getActiveAgentIdsFromSessionLanes,
  resolveAgentIdForRun,
} from "../../lib/status-session-lanes.js";
import { useReconnectScrollArea } from "../../reconnect-ui-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import {
  buildRootSessionsByAgent,
  buildSessionsByKey,
  type AgentsPageNavigationIntent,
  type EditorMode,
  isSessionWithinRootLineage,
  reconcileActiveRootByAgentKey,
  resolveActiveRootSessionKey,
  selectInitialAgentKey,
  type ManagedAgentOption,
} from "./agents-page.lib.js";
import { useAgentsPageNavigationIntent } from "./agents-page.navigation.js";
import {
  AgentsPageEditorDialog,
  AgentsPageSidebar,
  EmptyTimelinePanel,
} from "./agents-page.parts.js";
import { AgentsPageToolbarActions, StopSubagentErrorBanner } from "./agents-page.toolbar.js";
import { normalizeAgentOptions } from "./agent-options.shared.js";
import {
  buildInspectorFields,
  collectSelectedEventArtifacts,
  DEFAULT_KIND_FILTERS,
  type TimelineKindFilters,
} from "./transcripts-page.lib.js";
import { TranscriptInspectorPanel, TranscriptTimelinePanel } from "./transcripts-page.parts.js";

export function AgentsPage({
  core,
  navigationIntent = null,
  onNavigationIntentHandled,
}: {
  core: OperatorCore;
  navigationIntent?: AgentsPageNavigationIntent | null;
  onNavigationIntentHandled?: () => void;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const runs = useOperatorStore(core.runsStore);
  const status = useOperatorStore(core.statusStore);
  const transcript = useOperatorStore(core.transcriptStore);

  const [agentOptions, setAgentOptions] = useState<ManagedAgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentKey, setSelectedAgentKey] = useState("");
  const [selectedSubagentSessionKey, setSelectedSubagentSessionKey] = useState<string | null>(null);
  const [activeRootByAgentKey, setActiveRootByAgentKey] = useState<Record<string, string>>({});
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [kindFilters, setKindFilters] = useState<TimelineKindFilters>(DEFAULT_KIND_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("closed");
  const [createNonce, setCreateNonce] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [stoppingSubagentId, setStoppingSubagentId] = useState<string | null>(null);

  const deleteAction = useApiAction<void>();
  const stopAction = useApiAction<void>();
  const agentListScrollAreaRef = useReconnectScrollArea("agents.tree");
  const isConnected = connection.status === "connected";
  const isRefreshing = agentsLoading || transcript.loadingList || transcript.loadingDetail;

  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(runs.runsById)) {
      if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") {
        continue;
      }
      const agentId = resolveAgentIdForRun(run, runs.agentKeyByRunId);
      if (agentId) {
        ids.add(agentId);
      }
    }
    for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
      ids.add(agentId);
    }
    return ids;
  }, [runs.agentKeyByRunId, runs.runsById, status.status?.session_lanes]);

  const sessionsByKey = useMemo(() => {
    return buildSessionsByKey([
      ...(transcript.sessions ?? []),
      ...(transcript.detail?.sessions ?? []),
    ]);
  }, [transcript.detail?.sessions, transcript.sessions]);
  const rootsByAgent = useMemo(
    () => buildRootSessionsByAgent(transcript.sessions),
    [transcript.sessions],
  );

  const selectedAgentOption = useMemo(
    () => agentOptions.find((agent) => agent.agentKey === selectedAgentKey) ?? null,
    [agentOptions, selectedAgentKey],
  );
  const selectedAgentRoots = useMemo(
    () => rootsByAgent.get(selectedAgentKey) ?? [],
    [rootsByAgent, selectedAgentKey],
  );
  const activeRootSessionKey = useMemo(
    () =>
      selectedAgentKey
        ? resolveActiveRootSessionKey({
            agentKey: selectedAgentKey,
            activeRootByAgentKey,
            rootsByAgent,
          })
        : null,
    [activeRootByAgentKey, rootsByAgent, selectedAgentKey],
  );
  const detailTargetSessionKey = selectedSubagentSessionKey ?? activeRootSessionKey;
  const detailTargetSessionKeyRef = useRef<string | null>(detailTargetSessionKey);
  detailTargetSessionKeyRef.current = detailTargetSessionKey;
  const approvalsById = useMemo(() => {
    const entries = (transcript.detail?.events ?? [])
      .filter((event): event is TranscriptApprovalEvent => event.kind === "approval")
      .map((event) => [event.payload.approval.approval_id, event.payload.approval] as const);
    return Object.fromEntries(entries) as Record<string, Approval>;
  }, [transcript.detail?.events]);
  const visibleEvents = useMemo(
    () => (transcript.detail?.events ?? []).filter((event) => kindFilters[event.kind]),
    [kindFilters, transcript.detail?.events],
  );
  const selectedEvent = visibleEvents.find((event) => event.event_id === selectedEventId) ?? null;
  const focusSession =
    (transcript.detail?.focusSessionKey
      ? sessionsByKey.get(transcript.detail.focusSessionKey)
      : undefined) ??
    (detailTargetSessionKey ? sessionsByKey.get(detailTargetSessionKey) : undefined) ??
    null;
  const inspectorFields = useMemo(
    () => buildInspectorFields(selectedEvent, focusSession),
    [focusSession, selectedEvent],
  );
  const selectedEventArtifacts = useMemo(
    () => collectSelectedEventArtifacts(selectedEvent),
    [selectedEvent],
  );

  const refreshManagedAgents = async (preferredAgentKey?: string): Promise<void> => {
    if (!isConnected) {
      return;
    }
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const response = await core.admin.agents.list();
      const nextAgents = normalizeAgentOptions(
        response.agents,
        ({ agentKey, personaName, source }) => ({
          agentKey,
          agentId: source.agent_id.trim(),
          displayName: personaName || agentKey,
          canDelete: source.can_delete,
          isPrimary: source.is_primary === true,
        }),
        {
          sort: (left, right) => left.displayName.localeCompare(right.displayName),
        },
      );
      setAgentOptions(nextAgents);
      setSelectedAgentKey((current) =>
        selectInitialAgentKey({
          currentAgentKey: preferredAgentKey ?? current,
          availableAgents: nextAgents,
        }),
      );
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : String(error));
      setAgentOptions([]);
    } finally {
      setAgentsLoading(false);
    }
  };

  const refreshEverything = async (): Promise<void> => {
    if (!isConnected) {
      return;
    }
    core.transcriptStore.setAgentKey(null);
    core.transcriptStore.setChannel(null);
    core.transcriptStore.setActiveOnly(false);
    core.transcriptStore.setArchived(false);
    await Promise.all([refreshManagedAgents(), core.transcriptStore.refresh()]);
  };

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void refreshEverything();
  }, [isConnected]);

  useEffect(() => {
    if (agentOptions.length === 0) {
      return;
    }
    setSelectedAgentKey((current) =>
      selectInitialAgentKey({
        currentAgentKey: current,
        availableAgents: agentOptions,
      }),
    );
  }, [agentOptions]);

  useEffect(() => {
    setActiveRootByAgentKey((current) =>
      reconcileActiveRootByAgentKey({
        currentByAgentKey: current,
        agentKeys: agentOptions.map((agent) => agent.agentKey),
        rootsByAgent,
      }),
    );
  }, [agentOptions, rootsByAgent]);

  useEffect(() => {
    if (!selectedSubagentSessionKey) {
      return;
    }
    if (!activeRootSessionKey || !selectedAgentKey) {
      setSelectedSubagentSessionKey(null);
      setSelectedEventId(null);
      return;
    }
    if (
      isSessionWithinRootLineage({
        sessionKey: selectedSubagentSessionKey,
        rootSessionKey: activeRootSessionKey,
        sessionsByKey,
      })
    ) {
      return;
    }
    setSelectedSubagentSessionKey(null);
    setSelectedEventId(null);
  }, [activeRootSessionKey, selectedAgentKey, selectedSubagentSessionKey, sessionsByKey]);

  useEffect(() => {
    setSelectedEventId((current) => {
      if (visibleEvents.length === 0) {
        return null;
      }
      if (current && visibleEvents.some((event) => event.event_id === current)) {
        return current;
      }
      return visibleEvents[visibleEvents.length - 1]?.event_id ?? null;
    });
  }, [visibleEvents]);

  useEffect(() => {
    if (!isConnected || transcript.loadingList || transcript.loadingDetail) {
      return;
    }
    if (!selectedAgentKey || !detailTargetSessionKey) {
      if (transcript.detail || transcript.selectedSessionKey) {
        core.transcriptStore.clearDetail();
      }
      return;
    }
    if (
      transcript.selectedSessionKey === detailTargetSessionKey &&
      transcript.detail?.focusSessionKey === detailTargetSessionKey
    ) {
      return;
    }
    if (
      transcript.errorDetail &&
      transcript.selectedSessionKey === detailTargetSessionKey &&
      !transcript.detail
    ) {
      return;
    }
    void core.transcriptStore.openSession(detailTargetSessionKey);
  }, [
    core.transcriptStore,
    detailTargetSessionKey,
    isConnected,
    selectedAgentKey,
    transcript.detail,
    transcript.errorDetail,
    transcript.loadingDetail,
    transcript.loadingList,
    transcript.selectedSessionKey,
  ]);

  useAgentsPageNavigationIntent({
    navigationIntent,
    agentsLoading,
    agentOptions,
    transcript,
    sessionsByKey,
    onNavigationIntentHandled,
    setSelectedAgentKey,
    setActiveRootByAgentKey,
    setSelectedSubagentSessionKey,
    setSelectedEventId,
  });

  const openCreateEditor = () => {
    setCreateNonce((current) => current + 1);
    setEditorMode("create");
  };

  const handleStopSubagent = async (
    agentKey: string,
    session: TranscriptConversationSummary,
  ): Promise<void> => {
    const subagentId = session.subagent_id?.trim();
    if (!subagentId) {
      return;
    }
    setStoppingSubagentId(subagentId);
    try {
      await stopAction.runAndThrow(async () => {
        await core.chatSocket.requestDynamic(
          "subagent.close",
          {
            agent_key: agentKey,
            subagent_id: subagentId,
            reason: "Stopped from operator UI",
          },
          WsSubagentCloseResultSchema,
        );
      });
      await core.transcriptStore.refresh();
      const latestDetailTargetSessionKey = detailTargetSessionKeyRef.current;
      if (latestDetailTargetSessionKey) {
        await core.transcriptStore.openSession(latestDetailTargetSessionKey);
      }
    } finally {
      setStoppingSubagentId((current) => (current === subagentId ? null : current));
    }
  };

  return (
    <AppPage
      title="Agents"
      contentLayout="fill"
      contentClassName="max-w-none gap-0 px-0 py-0"
      data-testid="agents-page"
      actions={
        <AgentsPageToolbarActions
          selectedAgentRoots={selectedAgentRoots}
          activeRootSessionKey={activeRootSessionKey}
          selectedAgentKey={selectedAgentKey}
          renderMode={renderMode}
          isConnected={isConnected}
          isRefreshing={isRefreshing}
          onSelectRoot={({ agentKey, rootSessionKey }) => {
            setActiveRootByAgentKey((current) => ({
              ...current,
              [agentKey]: rootSessionKey,
            }));
            setSelectedSubagentSessionKey(null);
            setSelectedEventId(null);
          }}
          onSelectRenderMode={setRenderMode}
          onRefresh={() => {
            void refreshEverything();
          }}
          onCreateAgent={openCreateEditor}
        />
      }
    >
      <AgentsPageEditorDialog
        core={core}
        editorMode={editorMode}
        createNonce={createNonce}
        selectedAgentOption={selectedAgentOption}
        deleteOpen={deleteOpen}
        deleteLoading={deleteAction.isLoading}
        onDeleteOpenChange={setDeleteOpen}
        onDeleteConfirm={async () => {
          if (!selectedAgentOption) {
            return;
          }
          await deleteAction.runAndThrow(async () => {
            await core.admin.agents.delete(selectedAgentOption.agentKey);
          });
          setEditorMode("closed");
          await refreshManagedAgents();
        }}
        onClose={() => {
          setEditorMode("closed");
        }}
        onSaved={(savedAgentKey) => {
          setEditorMode("closed");
          void refreshManagedAgents(savedAgentKey);
        }}
      />

      {!isConnected ? (
        <div className="border-b border-border px-4 py-3">
          <Alert
            variant="warning"
            title="Not connected"
            description="Connect to the gateway to inspect retained transcript history."
          />
        </div>
      ) : null}

      {stopAction.error ? <StopSubagentErrorBanner error={stopAction.error} /> : null}

      <div
        className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)_320px]"
        data-testid="agents-content-layout"
      >
        <AgentsPageSidebar
          scrollAreaRef={agentListScrollAreaRef}
          agentsError={agentsError}
          transcriptErrorListMessage={transcript.errorList?.message ?? null}
          agentsLoading={agentsLoading}
          agentOptions={agentOptions}
          rootsByAgent={rootsByAgent}
          activeAgentIds={activeAgentIds}
          activeRootByAgentKey={activeRootByAgentKey}
          sessionsByKey={sessionsByKey}
          selectedAgentKey={selectedAgentKey}
          selectedSubagentSessionKey={selectedSubagentSessionKey}
          stoppingSubagentId={stoppingSubagentId}
          stopActionLoading={stopAction.isLoading}
          nextCursor={transcript.nextCursor}
          transcriptLoadingList={transcript.loadingList}
          onSelectAgent={(agentKey) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentSessionKey(null);
            setSelectedEventId(null);
          }}
          onEditAgent={(agentKey) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentSessionKey(null);
            setSelectedEventId(null);
            setEditorMode("edit");
          }}
          onSelectSubagent={({ agentKey, sessionKey }) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentSessionKey(sessionKey);
            setSelectedEventId(null);
          }}
          onStopSubagent={({ agentKey, session }) => {
            void handleStopSubagent(agentKey, session);
          }}
          onLoadMore={() => {
            void core.transcriptStore.loadMore();
          }}
        />

        <div className="min-h-0" data-testid="agents-detail-pane">
          {agentOptions.length === 0 ? (
            <EmptyTimelinePanel
              testId="agents-empty-state"
              title="No agent selected"
              description="Create a managed agent to inspect transcripts and retained subagent context."
            />
          ) : !selectedAgentOption ? (
            <EmptyTimelinePanel
              testId="agents-empty-state"
              title="No agent selected"
              description="Choose an agent from the left to inspect its retained transcript history."
            />
          ) : !activeRootSessionKey ? (
            <EmptyTimelinePanel
              testId="agents-empty-transcripts"
              title="No retained transcripts"
              description="This agent does not have retained transcript history yet."
            />
          ) : (
            <TranscriptTimelinePanel
              approvalsById={approvalsById}
              errorDetailMessage={transcript.errorDetail?.message ?? null}
              focusSession={focusSession}
              kindFilters={kindFilters}
              loadingDetail={transcript.loadingDetail}
              renderMode={renderMode}
              selectedEventId={selectedEventId}
              sessionsByKey={sessionsByKey}
              transcriptDetailPresent={transcript.detail !== null}
              visibleEvents={visibleEvents}
              onToggleKind={(kind) => {
                setKindFilters((current) => ({ ...current, [kind]: !current[kind] }));
              }}
              onSelectEvent={setSelectedEventId}
            />
          )}
        </div>

        <TranscriptInspectorPanel
          core={core}
          focusSession={focusSession}
          inspectorFields={inspectorFields}
          selectedEvent={selectedEvent}
          selectedEventArtifacts={selectedEventArtifacts}
        />
      </div>
    </AppPage>
  );
}
