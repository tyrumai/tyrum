import type { OperatorCore } from "@tyrum/operator-app";
import type { Approval, TranscriptApprovalEvent, TranscriptSessionSummary } from "@tyrum/contracts";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { AppPage } from "../layout/app-page.js";
import { Button } from "../ui/button.js";
import {
  buildInspectorFields,
  buildSessionTreeEntries,
  collectSelectedEventArtifacts,
  DEFAULT_KIND_FILTERS,
  normalizeAgentOptions,
  type AgentOption,
  type TimelineKindFilters,
} from "./transcripts-page.lib.js";
import { TranscriptInspectorPanel, TranscriptTimelinePanel } from "./transcripts-page.parts.js";
import { TranscriptSidebar } from "./transcripts-page.sidebar.js";

export function TranscriptsPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const transcript = useOperatorStore(core.transcriptStore);
  const isConnected = connection.status === "connected";

  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [kindFilters, setKindFilters] = useState<TimelineKindFilters>(DEFAULT_KIND_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let cancelled = false;
    void core.admin.agents
      .list()
      .then((response) => {
        if (!cancelled) {
          setAgentOptions(normalizeAgentOptions(response.agents));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [core.admin.agents, isConnected]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void core.transcriptStore.refresh();
  }, [
    core.transcriptStore,
    isConnected,
    transcript.activeOnly,
    transcript.agentId,
    transcript.archived,
    transcript.channel,
  ]);

  useEffect(() => {
    if (!isConnected || transcript.loadingList || transcript.loadingDetail) {
      return;
    }
    const selectedSessionKey = transcript.selectedSessionKey;
    if (!selectedSessionKey || transcript.detail?.focusSessionKey === selectedSessionKey) {
      return;
    }
    void core.transcriptStore.openSession(selectedSessionKey);
  }, [
    core.transcriptStore,
    isConnected,
    transcript.detail?.focusSessionKey,
    transcript.loadingDetail,
    transcript.loadingList,
    transcript.selectedSessionKey,
  ]);

  const sessionsByKey = useMemo(() => {
    const map = new Map<string, TranscriptSessionSummary>();
    for (const session of transcript.sessions) {
      map.set(session.session_key, session);
    }
    for (const session of transcript.detail?.sessions ?? []) {
      map.set(session.session_key, session);
    }
    return map;
  }, [transcript.detail?.sessions, transcript.sessions]);

  const sessionTreeEntries = useMemo(
    () => buildSessionTreeEntries([...sessionsByKey.values()]),
    [sessionsByKey],
  );
  const channelOptions = useMemo(
    () =>
      [...new Set([...sessionsByKey.values()].map((session) => session.channel))]
        .filter((channel) => channel.trim().length > 0)
        .toSorted((left, right) => left.localeCompare(right)),
    [sessionsByKey],
  );
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
    (transcript.selectedSessionKey
      ? sessionsByKey.get(transcript.selectedSessionKey)
      : undefined) ??
    null;
  const inspectorFields = useMemo(
    () => buildInspectorFields(selectedEvent, focusSession),
    [focusSession, selectedEvent],
  );
  const selectedEventArtifacts = useMemo(
    () => collectSelectedEventArtifacts(selectedEvent),
    [selectedEvent],
  );

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

  return (
    <AppPage
      title="Transcripts"
      contentLayout="fill"
      contentClassName="max-w-none gap-0 px-0 py-0"
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={renderMode === "markdown" ? "secondary" : "outline"}
            onClick={() => {
              setRenderMode("markdown");
            }}
          >
            Markdown
          </Button>
          <Button
            type="button"
            size="sm"
            variant={renderMode === "text" ? "secondary" : "outline"}
            onClick={() => {
              setRenderMode("text");
            }}
          >
            Plain text
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!isConnected || transcript.loadingList}
            isLoading={transcript.loadingList}
            onClick={() => {
              void core.transcriptStore.refresh();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <TranscriptSidebar
          agentOptions={agentOptions}
          channelOptions={channelOptions}
          core={core}
          loadingList={transcript.loadingList}
          errorListMessage={transcript.errorList?.message ?? null}
          sessionTreeEntries={sessionTreeEntries}
          nextCursor={transcript.nextCursor}
          selectedSessionKey={transcript.selectedSessionKey}
          agentId={transcript.agentId}
          channel={transcript.channel}
          activeOnly={transcript.activeOnly}
          archived={transcript.archived}
          onSelectSession={(sessionKey) => {
            setSelectedEventId(null);
            void core.transcriptStore.openSession(sessionKey);
          }}
        />
        <TranscriptTimelinePanel
          approvalsById={approvalsById}
          core={core}
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
