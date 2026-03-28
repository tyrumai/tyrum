import type { OperatorCore } from "@tyrum/operator-app";
import type {
  Approval,
  TranscriptApprovalEvent,
  TranscriptConversationSummary,
} from "@tyrum/contracts";
import { WsSubagentCloseResult as WsSubagentCloseResultSchema } from "@tyrum/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { collectActiveAgentKeys } from "../../lib/conversation-turn-activity.js";
import { useReconnectScrollArea } from "../../reconnect-ui-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import {
  buildConversationsByKey,
  buildRootConversationsByAgent,
  type AgentsPageNavigationIntent,
  type EditorMode,
  isConversationWithinRootLineage,
  reconcileActiveRootByAgentKey,
  resolveActiveRootConversationKey,
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
  const runs = useOperatorStore(core.turnsStore);
  const transcript = useOperatorStore(core.transcriptStore);

  const [agentOptions, setAgentOptions] = useState<ManagedAgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentKey, setSelectedAgentKey] = useState("");
  const [selectedSubagentConversationKey, setSelectedSubagentConversationKey] = useState<
    string | null
  >(null);
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
    return collectActiveAgentKeys({
      transcriptConversations: transcript.conversations,
      turnsState: runs,
    });
  }, [runs, transcript.conversations]);

  const conversationsByKey = useMemo(() => {
    return buildConversationsByKey([
      ...(transcript.conversations ?? []),
      ...(transcript.detail?.conversations ?? []),
    ]);
  }, [transcript.detail?.conversations, transcript.conversations]);
  const rootsByAgent = useMemo(
    () => buildRootConversationsByAgent(transcript.conversations),
    [transcript.conversations],
  );

  const selectedAgentOption = useMemo(
    () => agentOptions.find((agent) => agent.agentKey === selectedAgentKey) ?? null,
    [agentOptions, selectedAgentKey],
  );
  const selectedAgentRoots = useMemo(
    () => rootsByAgent.get(selectedAgentKey) ?? [],
    [rootsByAgent, selectedAgentKey],
  );
  const activeRootConversationKey = useMemo(
    () =>
      selectedAgentKey
        ? resolveActiveRootConversationKey({
            agentKey: selectedAgentKey,
            activeRootByAgentKey,
            rootsByAgent,
          })
        : null,
    [activeRootByAgentKey, rootsByAgent, selectedAgentKey],
  );
  const detailTargetConversationKey = selectedSubagentConversationKey ?? activeRootConversationKey;
  const detailTargetConversationKeyRef = useRef<string | null>(detailTargetConversationKey);
  detailTargetConversationKeyRef.current = detailTargetConversationKey;
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
  const focusConversation =
    (transcript.detail?.focusConversationKey
      ? conversationsByKey.get(transcript.detail.focusConversationKey)
      : undefined) ??
    (detailTargetConversationKey
      ? conversationsByKey.get(detailTargetConversationKey)
      : undefined) ??
    null;
  const inspectorFields = useMemo(
    () => buildInspectorFields(selectedEvent, focusConversation),
    [focusConversation, selectedEvent],
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
    if (!selectedSubagentConversationKey) {
      return;
    }
    if (!activeRootConversationKey || !selectedAgentKey) {
      setSelectedSubagentConversationKey(null);
      setSelectedEventId(null);
      return;
    }
    if (
      isConversationWithinRootLineage({
        conversationKey: selectedSubagentConversationKey,
        rootConversationKey: activeRootConversationKey,
        conversationsByKey,
      })
    ) {
      return;
    }
    setSelectedSubagentConversationKey(null);
    setSelectedEventId(null);
  }, [
    activeRootConversationKey,
    selectedAgentKey,
    selectedSubagentConversationKey,
    conversationsByKey,
  ]);

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
    if (!selectedAgentKey || !detailTargetConversationKey) {
      if (transcript.detail || transcript.selectedConversationKey) {
        core.transcriptStore.clearDetail();
      }
      return;
    }
    if (
      transcript.selectedConversationKey === detailTargetConversationKey &&
      transcript.detail?.focusConversationKey === detailTargetConversationKey
    ) {
      return;
    }
    if (
      transcript.errorDetail &&
      transcript.selectedConversationKey === detailTargetConversationKey &&
      !transcript.detail
    ) {
      return;
    }
    void core.transcriptStore.openConversation(detailTargetConversationKey);
  }, [
    core.transcriptStore,
    detailTargetConversationKey,
    isConnected,
    selectedAgentKey,
    transcript.detail,
    transcript.errorDetail,
    transcript.loadingDetail,
    transcript.loadingList,
    transcript.selectedConversationKey,
  ]);

  useAgentsPageNavigationIntent({
    navigationIntent,
    agentsLoading,
    agentOptions,
    transcript,
    conversationsByKey,
    onNavigationIntentHandled,
    setSelectedAgentKey,
    setActiveRootByAgentKey,
    setSelectedSubagentConversationKey,
    setSelectedEventId,
  });

  const openCreateEditor = () => {
    setCreateNonce((current) => current + 1);
    setEditorMode("create");
  };

  const handleStopSubagent = async (
    agentKey: string,
    conversation: TranscriptConversationSummary,
  ): Promise<void> => {
    const subagentId = conversation.subagent_id?.trim();
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
      const latestDetailTargetConversationKey = detailTargetConversationKeyRef.current;
      if (latestDetailTargetConversationKey) {
        await core.transcriptStore.openConversation(latestDetailTargetConversationKey);
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
          activeRootConversationKey={activeRootConversationKey}
          selectedAgentKey={selectedAgentKey}
          renderMode={renderMode}
          isConnected={isConnected}
          isRefreshing={isRefreshing}
          onSelectRoot={({ agentKey, rootConversationKey }) => {
            setActiveRootByAgentKey((current) => ({
              ...current,
              [agentKey]: rootConversationKey,
            }));
            setSelectedSubagentConversationKey(null);
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
          conversationsByKey={conversationsByKey}
          selectedAgentKey={selectedAgentKey}
          selectedSubagentConversationKey={selectedSubagentConversationKey}
          stoppingSubagentId={stoppingSubagentId}
          stopActionLoading={stopAction.isLoading}
          nextCursor={transcript.nextCursor}
          transcriptLoadingList={transcript.loadingList}
          onSelectAgent={(agentKey) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentConversationKey(null);
            setSelectedEventId(null);
          }}
          onEditAgent={(agentKey) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentConversationKey(null);
            setSelectedEventId(null);
            setEditorMode("edit");
          }}
          onSelectSubagent={({ agentKey, conversationKey }) => {
            setSelectedAgentKey(agentKey);
            setSelectedSubagentConversationKey(conversationKey);
            setSelectedEventId(null);
          }}
          onStopSubagent={({ agentKey, conversation }) => {
            void handleStopSubagent(agentKey, conversation);
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
          ) : !activeRootConversationKey ? (
            <EmptyTimelinePanel
              testId="agents-empty-transcripts"
              title="No retained transcripts"
              description="This agent does not have retained transcript history yet."
            />
          ) : (
            <TranscriptTimelinePanel
              approvalsById={approvalsById}
              errorDetailMessage={transcript.errorDetail?.message ?? null}
              focusConversation={focusConversation}
              kindFilters={kindFilters}
              loadingDetail={transcript.loadingDetail}
              renderMode={renderMode}
              selectedEventId={selectedEventId}
              conversationsByKey={conversationsByKey}
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
          focusConversation={focusConversation}
          inspectorFields={inspectorFields}
          selectedEvent={selectedEvent}
          selectedEventArtifacts={selectedEventArtifacts}
        />
      </div>
    </AppPage>
  );
}
