import {
  createTyrumAiSdkChatConversationClient,
  supportsTyrumAiSdkChatSocket,
  type TyrumAiSdkChatConversation,
  type TyrumAiSdkChatConversationSummary,
  type UIMessage,
} from "@tyrum/transport-sdk";
import { toOperatorCoreError } from "../operator-error.js";
import type { ChatState, ChatStoreContext } from "./chat-store.types.js";

function normalizeAgentKey(agentKey: string): string {
  return agentKey.trim();
}

function requireChatSocket(ctx: ChatStoreContext) {
  return supportsTyrumAiSdkChatSocket(ctx.ws) ? ctx.ws : null;
}

export function buildConversationClient(ctx: ChatStoreContext) {
  const socket = requireChatSocket(ctx);
  return socket ? createTyrumAiSdkChatConversationClient({ client: socket }) : null;
}

function toConversationSummary(
  conversation: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): TyrumAiSdkChatConversationSummary {
  return {
    conversation_id: conversation.conversation_id,
    agent_key: conversation.agent_key,
    channel: conversation.channel,
    thread_id: conversation.thread_id,
    title: conversation.title,
    message_count: conversation.message_count,
    updated_at: conversation.updated_at,
    created_at: conversation.created_at,
    last_message: conversation.last_message ?? null,
    archived: conversation.archived ?? false,
  };
}

function buildPreview(messages: UIMessage[]): TyrumAiSdkChatConversationSummary["last_message"] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== "text") {
        continue;
      }
      const text = typeof part.text === "string" ? part.text.trim() : "";
      if (text.length > 0) {
        return { role: message.role, text };
      }
    }
  }
  return null;
}

function compareConversationActivity(
  left: TyrumAiSdkChatConversationSummary,
  right: TyrumAiSdkChatConversationSummary,
): number {
  if (left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at);
  }
  return right.conversation_id.localeCompare(left.conversation_id);
}

function isComparableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toComparableEntries(record: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function areComparableValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areComparableValuesEqual(value, right[index]));
  }
  if (!isComparableRecord(left) || !isComparableRecord(right)) {
    return false;
  }

  const leftEntries = toComparableEntries(left);
  const rightEntries = toComparableEntries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([leftKey, leftValue], index) => {
    const rightEntry = rightEntries[index];
    return (
      rightEntry !== undefined &&
      leftKey === rightEntry[0] &&
      areComparableValuesEqual(leftValue, rightEntry[1])
    );
  });
}

function areMessagesEqual(left: UIMessage[], right: UIMessage[]): boolean {
  return areComparableValuesEqual(left, right);
}

export function patchConversationList(
  conversations: TyrumAiSdkChatConversationSummary[],
  conversation: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): TyrumAiSdkChatConversationSummary[] {
  const nextSummary = toConversationSummary(conversation);
  return [
    ...conversations.filter((entry) => entry.conversation_id !== nextSummary.conversation_id),
    nextSummary,
  ].toSorted(compareConversationActivity);
}

function routeConversationSummary(
  prev: ChatState,
  conversation: TyrumAiSdkChatConversation | TyrumAiSdkChatConversationSummary,
): Pick<ChatState, "archivedConversations" | "conversations"> {
  const nextSummary = toConversationSummary(conversation);
  const filteredActiveConversations = prev.conversations.conversations.filter(
    (entry) => entry.conversation_id !== nextSummary.conversation_id,
  );
  const filteredArchivedConversations = prev.archivedConversations.conversations.filter(
    (entry) => entry.conversation_id !== nextSummary.conversation_id,
  );

  if (nextSummary.archived) {
    const shouldPatchArchived =
      prev.archivedConversations.loaded ||
      prev.archivedConversations.conversations.some(
        (entry) => entry.conversation_id === nextSummary.conversation_id,
      );
    return {
      conversations: {
        ...prev.conversations,
        conversations: filteredActiveConversations,
      },
      archivedConversations: {
        ...prev.archivedConversations,
        conversations: shouldPatchArchived
          ? patchConversationList(prev.archivedConversations.conversations, nextSummary)
          : filteredArchivedConversations,
      },
    };
  }

  return {
    conversations: {
      ...prev.conversations,
      conversations: patchConversationList(prev.conversations.conversations, nextSummary),
    },
    archivedConversations: {
      ...prev.archivedConversations,
      conversations: filteredArchivedConversations,
    },
  };
}

function applyConversationMessages(
  conversation: TyrumAiSdkChatConversation,
  messages: UIMessage[],
): TyrumAiSdkChatConversation {
  return {
    ...conversation,
    messages,
    message_count: messages.length,
    last_message: buildPreview(messages),
    updated_at: new Date().toISOString(),
  };
}

export function setAgentKey(ctx: ChatStoreContext, agentKey: string): void {
  const nextAgentKey = normalizeAgentKey(agentKey);
  if (ctx.store.getSnapshot().agentKey === nextAgentKey) return;

  ctx.requestIds.conversations += 1;
  ctx.requestIds.archivedConversations += 1;
  ctx.requestIds.openConversation += 1;
  ctx.setState((prev) => ({
    ...prev,
    agentKey: nextAgentKey,
    conversations: { conversations: [], nextCursor: null, loading: false, error: null },
    archivedConversations: {
      conversations: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: {
      conversationId: null,
      conversation: null,
      loading: false,
      error: null,
    },
  }));
}

export async function refreshAgents(
  ctx: ChatStoreContext,
  input?: { includeDefault?: boolean },
): Promise<void> {
  const requestId = ++ctx.requestIds.agents;
  ctx.setState((prev) => ({ ...prev, agents: { ...prev.agents, loading: true, error: null } }));
  try {
    const res = await ctx.http.agentList.get({
      include_default: input?.includeDefault ?? true,
    });
    if (requestId !== ctx.requestIds.agents) return;
    ctx.setState((prev) => ({
      ...prev,
      agents: {
        agents: res.agents.map((agent) => ({
          agent_key: agent.agent_key,
          persona: agent.persona,
        })),
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (requestId !== ctx.requestIds.agents) return;
    ctx.setState((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        loading: false,
        error: toOperatorCoreError("http", "agent.list", err),
      },
    }));
  }
}

export async function refreshConversations(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  if (!conversationClient) {
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        loading: false,
        error: toOperatorCoreError(
          "ws",
          "conversation.list",
          new Error("conversation transport unavailable"),
        ),
      },
    }));
    return;
  }

  const requestId = ++ctx.requestIds.conversations;
  ctx.setState((prev) => ({
    ...prev,
    conversations: { ...prev.conversations, loading: true, error: null, nextCursor: null },
  }));
  try {
    const agentKey = ctx.store.getSnapshot().agentKey;
    const res = await conversationClient.list({
      channel: "ui",
      limit: 50,
      ...(agentKey ? { agent_key: agentKey } : {}),
    });
    if (requestId !== ctx.requestIds.conversations) return;
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        conversations: res.conversations,
        nextCursor: res.next_cursor ?? null,
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (requestId !== ctx.requestIds.conversations) return;
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}

export async function loadMoreConversations(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!conversationClient || snapshot.conversations.loading) return;
  const cursor = snapshot.conversations.nextCursor;
  if (!cursor) return;

  const requestId = ++ctx.requestIds.conversations;
  ctx.setState((prev) => ({
    ...prev,
    conversations: { ...prev.conversations, loading: true, error: null },
  }));

  try {
    const res = await conversationClient.list({
      channel: "ui",
      limit: 50,
      cursor,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (requestId !== ctx.requestIds.conversations) return;
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        conversations: [...prev.conversations.conversations, ...res.conversations],
        nextCursor: res.next_cursor ?? null,
        loading: false,
        error: null,
      },
    }));
  } catch (err) {
    if (requestId !== ctx.requestIds.conversations) return;
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}

export async function openConversation(
  ctx: ChatStoreContext,
  conversationId: string,
): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  const trimmed = conversationId.trim();
  if (!conversationClient || !trimmed) return;

  const requestId = ++ctx.requestIds.openConversation;
  ctx.setState((prev) => ({
    ...prev,
    active: {
      ...prev.active,
      conversationId: trimmed,
      conversation: null,
      loading: true,
      error: null,
    },
  }));

  try {
    const conversation = await conversationClient.get({ conversation_id: trimmed });
    if (requestId !== ctx.requestIds.openConversation) return;
    hydrateActiveConversation(ctx, conversation);
  } catch (err) {
    if (requestId !== ctx.requestIds.openConversation) return;
    ctx.setState((prev) => ({
      ...prev,
      active: {
        ...prev.active,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.get", err),
      },
    }));
  }
}

export async function newChat(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  if (!conversationClient) return;

  ctx.setState((prev) => ({ ...prev, conversations: { ...prev.conversations, error: null } }));
  const expectedAgentKey = ctx.store.getSnapshot().agentKey;
  try {
    const created = await conversationClient.create({
      channel: "ui",
      ...(expectedAgentKey ? { agent_key: expectedAgentKey } : {}),
    });
    if (ctx.store.getSnapshot().agentKey !== expectedAgentKey) return;
    hydrateActiveConversation(ctx, created);
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        error: toOperatorCoreError("ws", "conversation.create", err),
      },
    }));
  }
}

export function hydrateActiveConversation(
  ctx: ChatStoreContext,
  conversation: TyrumAiSdkChatConversation | null,
): void {
  ctx.setState((prev) => ({
    ...prev,
    ...(conversation === null ? {} : routeConversationSummary(prev, conversation)),
    active:
      conversation === null
        ? {
            conversationId: null,
            conversation: null,
            loading: false,
            error: null,
          }
        : {
            conversationId: conversation.conversation_id,
            conversation,
            loading: false,
            error: null,
          },
  }));
}

export function updateActiveMessages(ctx: ChatStoreContext, messages: UIMessage[]): void {
  ctx.setState((prev) => {
    const conversation = prev.active.conversation;
    if (!conversation || areMessagesEqual(conversation.messages, messages)) {
      return prev;
    }
    const nextConversation = applyConversationMessages(conversation, messages);
    return {
      ...prev,
      ...routeConversationSummary(prev, nextConversation),
      active: {
        ...prev.active,
        conversation: nextConversation,
      },
    };
  });
}

export async function deleteActive(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  const conversationId = snapshot.active.conversationId;
  if (!conversationClient || !conversationId) return;

  ctx.setState((prev) => ({ ...prev, active: { ...prev.active, error: null } }));
  try {
    await conversationClient.delete({ conversation_id: conversationId });
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        conversations: prev.conversations.conversations.filter(
          (conversation) => conversation.conversation_id !== conversationId,
        ),
      },
      archivedConversations: {
        ...prev.archivedConversations,
        conversations: prev.archivedConversations.conversations.filter(
          (conversation) => conversation.conversation_id !== conversationId,
        ),
      },
      active:
        prev.active.conversationId === conversationId
          ? {
              conversationId: null,
              conversation: null,
              loading: false,
              error: null,
            }
          : prev.active,
    }));
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      active: { ...prev.active, error: toOperatorCoreError("ws", "conversation.delete", err) },
    }));
  }
}

export {
  archiveConversation,
  unarchiveConversation,
  loadArchivedConversations,
  loadMoreArchivedConversations,
} from "./chat-store-archive.actions.js";
