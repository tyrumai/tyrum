import type { TranscriptSessionSummary, TranscriptTimelineEvent } from "@tyrum/contracts";
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import {
  resolveSessionSelectionForIntent,
  type AgentsPageNavigationIntent,
  type ManagedAgentOption,
} from "./agents-page.lib.js";

export function useAgentsPageNavigationIntent(input: {
  navigationIntent: AgentsPageNavigationIntent | null;
  agentsLoading: boolean;
  agentOptions: ManagedAgentOption[];
  transcript: {
    sessions: TranscriptSessionSummary[];
    detail: { events: TranscriptTimelineEvent[] } | null;
    loadingList: boolean;
    loadingDetail: boolean;
  };
  sessionsByKey: ReadonlyMap<string, TranscriptSessionSummary>;
  onNavigationIntentHandled?: () => void;
  setSelectedAgentKey: Dispatch<SetStateAction<string>>;
  setActiveRootByAgentKey: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedSubagentSessionKey: Dispatch<SetStateAction<string | null>>;
  setSelectedEventId: Dispatch<SetStateAction<string | null>>;
}): void {
  const navigationIntentKey = useMemo(() => {
    if (!input.navigationIntent) {
      return null;
    }
    return `${input.navigationIntent.agentKey}:${input.navigationIntent.runId ?? ""}:${input.navigationIntent.sessionKey ?? ""}`;
  }, [input.navigationIntent]);
  const lastAppliedNavigationKeyRef = useRef<string | null>(null);
  const pendingNavigationRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (input.navigationIntent) {
      return;
    }
    lastAppliedNavigationKeyRef.current = null;
    pendingNavigationRunIdRef.current = null;
  }, [input.navigationIntent]);

  useEffect(() => {
    if (!input.navigationIntent || !navigationIntentKey) {
      return;
    }
    if (lastAppliedNavigationKeyRef.current === navigationIntentKey) {
      return;
    }
    if (input.agentsLoading || input.transcript.loadingList || input.agentOptions.length === 0) {
      return;
    }
    if (!input.agentOptions.some((agent) => agent.agentKey === input.navigationIntent?.agentKey)) {
      lastAppliedNavigationKeyRef.current = navigationIntentKey;
      input.onNavigationIntentHandled?.();
      return;
    }
    const { matchedSessionKey, rootSessionKey } = resolveSessionSelectionForIntent({
      intent: input.navigationIntent,
      sessions: input.transcript.sessions,
      sessionsByKey: input.sessionsByKey,
    });
    input.setSelectedAgentKey(input.navigationIntent.agentKey);
    if (rootSessionKey) {
      input.setActiveRootByAgentKey((current) => ({
        ...current,
        [input.navigationIntent!.agentKey]: rootSessionKey,
      }));
    }
    input.setSelectedSubagentSessionKey(
      matchedSessionKey && rootSessionKey && matchedSessionKey !== rootSessionKey
        ? matchedSessionKey
        : null,
    );
    input.setSelectedEventId(null);
    pendingNavigationRunIdRef.current = input.navigationIntent.runId ?? null;
    lastAppliedNavigationKeyRef.current = navigationIntentKey;
    input.onNavigationIntentHandled?.();
  }, [
    input.agentOptions,
    input.agentsLoading,
    input.navigationIntent,
    input.onNavigationIntentHandled,
    input.sessionsByKey,
    input.setActiveRootByAgentKey,
    input.setSelectedAgentKey,
    input.setSelectedEventId,
    input.setSelectedSubagentSessionKey,
    input.transcript.loadingList,
    input.transcript.sessions,
    navigationIntentKey,
  ]);

  useEffect(() => {
    const pendingRunId = pendingNavigationRunIdRef.current;
    if (!pendingRunId || input.transcript.loadingDetail || !input.transcript.detail) {
      return;
    }
    const matchingRunEvent = input.transcript.detail.events.find(
      (event) => event.kind === "run" && event.payload.run.run_id === pendingRunId,
    );
    input.setSelectedEventId(matchingRunEvent?.event_id ?? null);
    pendingNavigationRunIdRef.current = null;
  }, [input.setSelectedEventId, input.transcript.detail, input.transcript.loadingDetail]);
}
