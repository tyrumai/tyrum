import type {
  TranscriptConversationSummary,
  TranscriptTimelineEvent,
  WsTranscriptGetResult,
} from "@tyrum/contracts";
import { WsTranscriptGetResult as WsTranscriptGetResultSchema } from "@tyrum/contracts";
import { WsTranscriptListResult as WsTranscriptListResultSchema } from "@tyrum/contracts";
import type { OperatorWsClient } from "../deps.js";
import { toOperatorCoreError } from "../operator-error.js";
import { createStore, type ExternalStore } from "../store.js";

export interface TranscriptDetailState {
  rootSessionKey: string;
  focusSessionKey: string;
  sessions: TranscriptConversationSummary[];
  events: TranscriptTimelineEvent[];
}

export interface TranscriptState {
  agentKey: string | null;
  channel: string | null;
  activeOnly: boolean;
  archived: boolean;
  sessions: TranscriptConversationSummary[];
  nextCursor: string | null;
  selectedSessionKey: string | null;
  detail: TranscriptDetailState | null;
  loadingList: boolean;
  loadingDetail: boolean;
  errorList: ReturnType<typeof toOperatorCoreError> | null;
  errorDetail: ReturnType<typeof toOperatorCoreError> | null;
}

export interface TranscriptStore extends ExternalStore<TranscriptState> {
  setAgentKey(agentKey: string | null): void;
  setChannel(channel: string | null): void;
  setActiveOnly(activeOnly: boolean): void;
  setArchived(archived: boolean): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  openSession(sessionKey: string): Promise<void>;
  clearDetail(): void;
}

function createInitialTranscriptState(): TranscriptState {
  return {
    agentKey: null,
    channel: null,
    activeOnly: false,
    archived: false,
    sessions: [],
    nextCursor: null,
    selectedSessionKey: null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  };
}

function normalizeOptionalString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function flattenTranscriptSessionSummaries(
  sessions: readonly TranscriptConversationSummary[],
): TranscriptConversationSummary[] {
  const flattened: TranscriptConversationSummary[] = [];
  const visit = (session: TranscriptConversationSummary): void => {
    flattened.push({ ...session, child_conversations: undefined });
    for (const child of session.child_conversations ?? []) {
      visit(child);
    }
  };
  for (const session of sessions) {
    visit(session);
  }
  return flattened;
}

function mergeTranscriptSessionSummaries(
  current: readonly TranscriptConversationSummary[],
  incoming: readonly TranscriptConversationSummary[],
): TranscriptConversationSummary[] {
  const byKey = new Map<string, TranscriptConversationSummary>();
  for (const session of current) {
    byKey.set(session.conversation_key, session);
  }
  for (const session of incoming) {
    byKey.set(session.conversation_key, session);
  }
  return [...byKey.values()];
}

function toDetail(result: WsTranscriptGetResult): TranscriptDetailState {
  return {
    rootSessionKey: result.root_conversation_key,
    focusSessionKey: result.focus_conversation_key,
    sessions: result.conversations,
    events: result.events,
  };
}

export function createTranscriptStore(ws: OperatorWsClient): TranscriptStore {
  const { store, setState } = createStore<TranscriptState>(createInitialTranscriptState());
  let listRunId = 0;
  let detailRunId = 0;

  function invalidateListLoad(): void {
    listRunId += 1;
  }

  function invalidateDetailLoad(): void {
    detailRunId += 1;
  }

  async function refresh(): Promise<void> {
    const runId = ++listRunId;
    const snapshot = store.getSnapshot();
    setState((prev) => ({ ...prev, loadingList: true, errorList: null }));
    try {
      const result = await ws.requestDynamic(
        "transcript.list",
        {
          ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
          ...(snapshot.channel ? { channel: snapshot.channel } : {}),
          ...(snapshot.activeOnly ? { active_only: true } : {}),
          ...(snapshot.archived ? { archived: true } : {}),
          limit: 200,
        },
        WsTranscriptListResultSchema,
      );
      if (runId !== listRunId) {
        return;
      }
      const flattenedSessions = flattenTranscriptSessionSummaries(result.conversations);
      const previousSelectedSessionKey = store.getSnapshot().selectedSessionKey;
      setState((prev) => {
        const nextSelectedSessionKey =
          prev.selectedSessionKey &&
          flattenedSessions.some((session) => session.conversation_key === prev.selectedSessionKey)
            ? prev.selectedSessionKey
            : (flattenedSessions[0]?.conversation_key ?? null);
        return {
          ...prev,
          sessions: flattenedSessions,
          nextCursor: result.next_cursor ?? null,
          selectedSessionKey: nextSelectedSessionKey,
          loadingList: false,
          errorList: null,
          ...(nextSelectedSessionKey !== prev.selectedSessionKey
            ? { detail: null, errorDetail: null, loadingDetail: false }
            : {}),
        };
      });
      if (previousSelectedSessionKey !== store.getSnapshot().selectedSessionKey) {
        invalidateDetailLoad();
      }
    } catch (error) {
      if (runId !== listRunId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loadingList: false,
        nextCursor: null,
        errorList: toOperatorCoreError("ws", "transcript.list", error),
      }));
    }
  }

  async function loadMore(): Promise<void> {
    const snapshot = store.getSnapshot();
    if (snapshot.loadingList || !snapshot.nextCursor) {
      return;
    }

    const runId = ++listRunId;
    setState((prev) => ({ ...prev, loadingList: true, errorList: null }));
    try {
      const result = await ws.requestDynamic(
        "transcript.list",
        {
          ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
          ...(snapshot.channel ? { channel: snapshot.channel } : {}),
          ...(snapshot.activeOnly ? { active_only: true } : {}),
          ...(snapshot.archived ? { archived: true } : {}),
          limit: 200,
          cursor: snapshot.nextCursor,
        },
        WsTranscriptListResultSchema,
      );
      if (runId !== listRunId) {
        return;
      }
      const flattenedSessions = flattenTranscriptSessionSummaries(result.conversations);
      setState((prev) => ({
        ...prev,
        sessions: mergeTranscriptSessionSummaries(prev.sessions, flattenedSessions),
        nextCursor: result.next_cursor ?? null,
        loadingList: false,
        errorList: null,
      }));
    } catch (error) {
      if (runId !== listRunId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loadingList: false,
        errorList: toOperatorCoreError("ws", "transcript.list", error),
      }));
    }
  }

  async function openSession(sessionKey: string): Promise<void> {
    const normalizedSessionKey = sessionKey.trim();
    if (normalizedSessionKey.length === 0) {
      return;
    }
    const runId = ++detailRunId;
    setState((prev) => ({
      ...prev,
      selectedSessionKey: normalizedSessionKey,
      detail: prev.detail?.focusSessionKey === normalizedSessionKey ? prev.detail : null,
      loadingDetail: true,
      errorDetail: null,
    }));
    try {
      const result = await ws.requestDynamic(
        "transcript.get",
        { conversation_key: normalizedSessionKey },
        WsTranscriptGetResultSchema,
      );
      if (runId !== detailRunId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        selectedSessionKey: normalizedSessionKey,
        detail: toDetail(result),
        loadingDetail: false,
        errorDetail: null,
      }));
    } catch (error) {
      if (runId !== detailRunId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loadingDetail: false,
        errorDetail: toOperatorCoreError("ws", "transcript.get", error),
      }));
    }
  }

  return {
    ...store,
    setAgentKey(agentKey) {
      const nextAgentKey = normalizeOptionalString(agentKey);
      let shouldInvalidate = false;
      setState((prev) => {
        if (prev.agentKey === nextAgentKey) {
          return prev;
        }
        shouldInvalidate = true;
        return {
          ...prev,
          agentKey: nextAgentKey,
          sessions: [],
          nextCursor: null,
          selectedSessionKey: null,
          loadingList: false,
          detail: null,
          loadingDetail: false,
          errorList: null,
          errorDetail: null,
        };
      });
      if (shouldInvalidate) {
        invalidateListLoad();
        invalidateDetailLoad();
      }
    },
    setChannel(channel) {
      const nextChannel = normalizeOptionalString(channel);
      let shouldInvalidate = false;
      setState((prev) => {
        if (prev.channel === nextChannel) {
          return prev;
        }
        shouldInvalidate = true;
        return {
          ...prev,
          channel: nextChannel,
          sessions: [],
          nextCursor: null,
          selectedSessionKey: null,
          loadingList: false,
          detail: null,
          loadingDetail: false,
          errorList: null,
          errorDetail: null,
        };
      });
      if (shouldInvalidate) {
        invalidateListLoad();
        invalidateDetailLoad();
      }
    },
    setActiveOnly(activeOnly) {
      let shouldInvalidate = false;
      setState((prev) => {
        if (prev.activeOnly === activeOnly) {
          return prev;
        }
        shouldInvalidate = true;
        return {
          ...prev,
          activeOnly,
          sessions: [],
          nextCursor: null,
          selectedSessionKey: null,
          loadingList: false,
          detail: null,
          loadingDetail: false,
          errorList: null,
          errorDetail: null,
        };
      });
      if (shouldInvalidate) {
        invalidateListLoad();
        invalidateDetailLoad();
      }
    },
    setArchived(archived) {
      let shouldInvalidate = false;
      setState((prev) => {
        if (prev.archived === archived) {
          return prev;
        }
        shouldInvalidate = true;
        return {
          ...prev,
          archived,
          sessions: [],
          nextCursor: null,
          selectedSessionKey: null,
          loadingList: false,
          detail: null,
          loadingDetail: false,
          errorList: null,
          errorDetail: null,
        };
      });
      if (shouldInvalidate) {
        invalidateListLoad();
        invalidateDetailLoad();
      }
    },
    refresh,
    loadMore,
    openSession,
    clearDetail() {
      invalidateDetailLoad();
      setState((prev) => ({
        ...prev,
        selectedSessionKey: null,
        detail: null,
        loadingDetail: false,
        errorDetail: null,
      }));
    },
  };
}
