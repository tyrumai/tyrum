import type { TranscriptConversationSummary, TranscriptTimelineEvent } from "@tyrum/contracts";
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import {
  resolveConversationSelectionForIntent,
  type AgentsPageNavigationIntent,
  type ManagedAgentOption,
} from "./agents-page.lib.js";

export function useAgentsPageNavigationIntent(input: {
  navigationIntent: AgentsPageNavigationIntent | null;
  agentsLoading: boolean;
  agentOptions: ManagedAgentOption[];
  transcript: {
    conversations: TranscriptConversationSummary[];
    detail: { events: TranscriptTimelineEvent[] } | null;
    loadingList: boolean;
    loadingDetail: boolean;
  };
  sessionsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
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
    return `${input.navigationIntent.agentKey}:${input.navigationIntent.turnId ?? ""}:${input.navigationIntent.conversationKey ?? ""}`;
  }, [input.navigationIntent]);
  const lastAppliedNavigationKeyRef = useRef<string | null>(null);
  const pendingNavigationTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (input.navigationIntent) {
      return;
    }
    lastAppliedNavigationKeyRef.current = null;
    pendingNavigationTurnIdRef.current = null;
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
    const { matchedSessionKey, rootConversationKey } = resolveConversationSelectionForIntent({
      intent: input.navigationIntent,
      conversations: input.transcript.conversations,
      sessionsByKey: input.sessionsByKey,
    });
    input.setSelectedAgentKey(input.navigationIntent.agentKey);
    if (rootConversationKey) {
      input.setActiveRootByAgentKey((current) => ({
        ...current,
        [input.navigationIntent!.agentKey]: rootConversationKey,
      }));
    }
    input.setSelectedSubagentSessionKey(
      matchedSessionKey && rootConversationKey && matchedSessionKey !== rootConversationKey
        ? matchedSessionKey
        : null,
    );
    input.setSelectedEventId(null);
    pendingNavigationTurnIdRef.current = input.navigationIntent.turnId ?? null;
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
    input.transcript.conversations,
    navigationIntentKey,
  ]);

  useEffect(() => {
    const pendingTurnId = pendingNavigationTurnIdRef.current;
    if (!pendingTurnId || input.transcript.loadingDetail || !input.transcript.detail) {
      return;
    }
    const matchingRunEvent = input.transcript.detail.events.find(
      (event) => event.kind === "turn" && event.payload.turn.turn_id === pendingTurnId,
    );
    input.setSelectedEventId(matchingRunEvent?.event_id ?? null);
    pendingNavigationTurnIdRef.current = null;
  }, [input.setSelectedEventId, input.transcript.detail, input.transcript.loadingDetail]);
}
