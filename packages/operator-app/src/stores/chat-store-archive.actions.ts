import { toOperatorCoreError } from "../operator-error.js";
import { buildConversationClient, patchConversationList } from "./chat-store.actions.js";
import type { ChatStoreContext } from "./chat-store.types.js";

export async function archiveConversation(
  ctx: ChatStoreContext,
  conversationId: string,
): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  if (!conversationClient) return;

  try {
    await conversationClient.archive({ conversation_id: conversationId, archived: true });
    ctx.setState((prev) => {
      const conversation = prev.conversations.conversations.find(
        (entry) => entry.conversation_id === conversationId,
      );
      return {
        ...prev,
        conversations: {
          ...prev.conversations,
          conversations: prev.conversations.conversations.filter(
            (entry) => entry.conversation_id !== conversationId,
          ),
        },
        archivedConversations: conversation
          ? {
              ...prev.archivedConversations,
              conversations: prev.archivedConversations.loaded
                ? [{ ...conversation, archived: true }, ...prev.archivedConversations.conversations]
                : prev.archivedConversations.conversations,
            }
          : prev.archivedConversations,
        active:
          prev.active.conversationId === conversationId
            ? { conversationId: null, conversation: null, loading: false, error: null }
            : prev.active,
      };
    });
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      conversations: {
        ...prev.conversations,
        error: toOperatorCoreError("ws", "conversation.archive", err),
      },
    }));
  }
}

export async function unarchiveConversation(
  ctx: ChatStoreContext,
  conversationId: string,
): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  if (!conversationClient) return;

  try {
    await conversationClient.archive({ conversation_id: conversationId, archived: false });
    ctx.setState((prev) => {
      const conversation = prev.archivedConversations.conversations.find(
        (entry) => entry.conversation_id === conversationId,
      );
      return {
        ...prev,
        conversations: conversation
          ? {
              ...prev.conversations,
              conversations: patchConversationList(prev.conversations.conversations, {
                ...conversation,
                archived: false,
              }),
            }
          : prev.conversations,
        archivedConversations: {
          ...prev.archivedConversations,
          conversations: prev.archivedConversations.conversations.filter(
            (s) => s.conversation_id !== conversationId,
          ),
        },
      };
    });
  } catch (err) {
    ctx.setState((prev) => ({
      ...prev,
      archivedConversations: {
        ...prev.archivedConversations,
        error: toOperatorCoreError("ws", "conversation.archive", err),
      },
    }));
  }
}

export async function loadArchivedConversations(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!conversationClient || snapshot.archivedConversations.loading) return;

  const requestId = ++ctx.requestIds.archivedConversations;
  ctx.setState((prev) => ({
    ...prev,
    archivedConversations: { ...prev.archivedConversations, loading: true, error: null },
  }));
  try {
    const res = await conversationClient.list({
      channel: "ui",
      archived: true,
      limit: 50,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (requestId !== ctx.requestIds.archivedConversations) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedConversations: {
        conversations: res.conversations,
        nextCursor: res.next_cursor ?? null,
        loading: false,
        loaded: true,
        error: null,
      },
    }));
  } catch (err) {
    if (requestId !== ctx.requestIds.archivedConversations) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedConversations: {
        ...prev.archivedConversations,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}

export async function loadMoreArchivedConversations(ctx: ChatStoreContext): Promise<void> {
  const conversationClient = buildConversationClient(ctx);
  const snapshot = ctx.store.getSnapshot();
  if (!conversationClient || snapshot.archivedConversations.loading) return;
  const cursor = snapshot.archivedConversations.nextCursor;
  if (!cursor) return;

  const requestId = ++ctx.requestIds.archivedConversations;
  ctx.setState((prev) => ({
    ...prev,
    archivedConversations: { ...prev.archivedConversations, loading: true, error: null },
  }));
  try {
    const res = await conversationClient.list({
      channel: "ui",
      archived: true,
      limit: 50,
      cursor,
      ...(snapshot.agentKey ? { agent_key: snapshot.agentKey } : {}),
    });
    if (requestId !== ctx.requestIds.archivedConversations) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedConversations: {
        conversations: [...prev.archivedConversations.conversations, ...res.conversations],
        nextCursor: res.next_cursor ?? null,
        loading: false,
        loaded: true,
        error: null,
      },
    }));
  } catch (err) {
    if (requestId !== ctx.requestIds.archivedConversations) return;
    ctx.setState((prev) => ({
      ...prev,
      archivedConversations: {
        ...prev.archivedConversations,
        loading: false,
        error: toOperatorCoreError("ws", "conversation.list", err),
      },
    }));
  }
}
