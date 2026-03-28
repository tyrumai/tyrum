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

export interface TranscriptConversationDetailState {
  rootConversationKey: string;
  focusConversationKey: string;
  conversations: TranscriptConversationSummary[];
  events: TranscriptTimelineEvent[];
}

export interface TranscriptState {
  agentKey: string | null;
  channel: string | null;
  activeOnly: boolean;
  archived: boolean;
  conversations: TranscriptConversationSummary[];
  nextCursor: string | null;
  selectedConversationKey: string | null;
  detail: TranscriptConversationDetailState | null;
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
  openConversation(conversationKey: string): Promise<void>;
  clearDetail(): void;
}

function createInitialTranscriptState(): TranscriptState {
  return {
    agentKey: null,
    channel: null,
    activeOnly: false,
    archived: false,
    conversations: [],
    nextCursor: null,
    selectedConversationKey: null,
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

function flattenTranscriptConversationSummaries(
  conversations: readonly TranscriptConversationSummary[],
): TranscriptConversationSummary[] {
  const flattened: TranscriptConversationSummary[] = [];
  const visit = (conversation: TranscriptConversationSummary): void => {
    flattened.push({ ...conversation, child_conversations: undefined });
    for (const child of conversation.child_conversations ?? []) {
      visit(child);
    }
  };
  for (const conversation of conversations) {
    visit(conversation);
  }
  return flattened;
}

function mergeTranscriptConversationSummaries(
  current: readonly TranscriptConversationSummary[],
  incoming: readonly TranscriptConversationSummary[],
): TranscriptConversationSummary[] {
  const byKey = new Map<string, TranscriptConversationSummary>();
  for (const conversation of current) {
    byKey.set(conversation.conversation_key, conversation);
  }
  for (const conversation of incoming) {
    byKey.set(conversation.conversation_key, conversation);
  }
  return [...byKey.values()];
}

function toDetail(result: WsTranscriptGetResult): TranscriptConversationDetailState {
  return {
    rootConversationKey: result.root_conversation_key,
    focusConversationKey: result.focus_conversation_key,
    conversations: result.conversations,
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
      const flattenedConversations = flattenTranscriptConversationSummaries(result.conversations);
      const previousSelectedConversationKey = store.getSnapshot().selectedConversationKey;
      setState((prev) => {
        const nextSelectedConversationKey =
          prev.selectedConversationKey &&
          flattenedConversations.some(
            (conversation) => conversation.conversation_key === prev.selectedConversationKey,
          )
            ? prev.selectedConversationKey
            : (flattenedConversations[0]?.conversation_key ?? null);
        return {
          ...prev,
          conversations: flattenedConversations,
          nextCursor: result.next_cursor ?? null,
          selectedConversationKey: nextSelectedConversationKey,
          loadingList: false,
          errorList: null,
          ...(nextSelectedConversationKey !== prev.selectedConversationKey
            ? { detail: null, errorDetail: null, loadingDetail: false }
            : {}),
        };
      });
      if (previousSelectedConversationKey !== store.getSnapshot().selectedConversationKey) {
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
      const flattenedConversations = flattenTranscriptConversationSummaries(result.conversations);
      setState((prev) => ({
        ...prev,
        conversations: mergeTranscriptConversationSummaries(
          prev.conversations,
          flattenedConversations,
        ),
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

  async function openConversation(conversationKey: string): Promise<void> {
    const normalizedConversationKey = conversationKey.trim();
    if (normalizedConversationKey.length === 0) {
      return;
    }
    const runId = ++detailRunId;
    setState((prev) => ({
      ...prev,
      selectedConversationKey: normalizedConversationKey,
      detail: prev.detail?.focusConversationKey === normalizedConversationKey ? prev.detail : null,
      loadingDetail: true,
      errorDetail: null,
    }));
    try {
      const result = await ws.requestDynamic(
        "transcript.get",
        { conversation_key: normalizedConversationKey },
        WsTranscriptGetResultSchema,
      );
      if (runId !== detailRunId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        selectedConversationKey: normalizedConversationKey,
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
          conversations: [],
          nextCursor: null,
          selectedConversationKey: null,
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
          conversations: [],
          nextCursor: null,
          selectedConversationKey: null,
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
          conversations: [],
          nextCursor: null,
          selectedConversationKey: null,
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
          conversations: [],
          nextCursor: null,
          selectedConversationKey: null,
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
    openConversation,
    clearDetail() {
      invalidateDetailLoad();
      setState((prev) => ({
        ...prev,
        selectedConversationKey: null,
        detail: null,
        loadingDetail: false,
        errorDetail: null,
      }));
    },
  };
}
