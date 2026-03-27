import { createStore } from "@tyrum/operator-app";

export function createChatStore() {
  const assistantMarkdown = [
    "# Markdown Rendering",
    "",
    "Preflight should keep real markdown semantics inside the chat bubble:",
    "",
    "- first bullet",
    "- second bullet with `inline code` and a [docs link](https://example.com/docs)",
    "",
    "```ts",
    "const viewportWidth = 1280;",
    "```",
  ].join("\n");

  const activeConversation = {
    conversation_id: "session-1",
    agent_key: "default",
    channel: "ui",
    thread_id: "ui-thread-1",
    title: "Layout regression coverage",
    message_count: 2,
    last_message: {
      role: "assistant" as const,
      text: "Rendered markdown with heading, list, link, and code block.",
    },
    messages: [
      {
        id: "turn-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Can we prevent page overflow regressions?" }],
      },
      {
        id: "turn-2",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: assistantMarkdown }],
      },
    ],
    updated_at: "2026-03-08T00:00:00.000Z",
    created_at: "2026-03-08T00:00:00.000Z",
  };

  const toConversationSummary = (conversation: typeof activeConversation) => ({
    agent_key: conversation.agent_key,
    conversation_id: conversation.conversation_id,
    channel: conversation.channel,
    thread_id: conversation.thread_id,
    title: conversation.title,
    message_count: conversation.message_count,
    last_message: conversation.last_message,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  });

  const buildLastMessage = (messages: typeof activeConversation.messages) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      for (const part of message.parts) {
        if (part.type !== "text") {
          continue;
        }
        const text = part.text?.trim() ?? "";
        if (text.length > 0) {
          return {
            role: message.role,
            text,
          };
        }
      }
    }
    return null;
  };

  const { store, setState } = createStore({
    agentKey: "default",
    agents: {
      agents: [{ agent_key: "default" }, { agent_key: "agent-1" }],
      loading: false,
      error: null,
    },
    conversations: {
      conversations: [toConversationSummary(activeConversation)],
      nextCursor: null,
      loading: false,
      error: null,
    },
    archivedConversations: {
      conversations: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: {
      conversationId: activeConversation.conversation_id,
      conversation: activeConversation,
      loading: false,
      error: null,
    },
  });

  return {
    ...store,
    setAgentKey(agentKey: string) {
      setState((previous) => ({ ...previous, agentKey }));
    },
    refreshAgents: async () => {},
    refreshConversations: async () => {},
    loadMoreConversations: async () => {},
    openConversation: async (conversationId: string) => {
      setState((previous) => ({
        ...previous,
        active: {
          ...previous.active,
          conversationId,
          conversation: activeConversation,
        },
      }));
    },
    newChat: async () => {},
    deleteActive: async () => {},
    archiveConversation: async () => {},
    unarchiveConversation: async () => {},
    loadArchivedConversations: async () => {},
    loadMoreArchivedConversations: async () => {},
    hydrateActiveConversation: (conversation: typeof activeConversation | null) => {
      setState((previous) => ({
        ...previous,
        conversations:
          conversation === null
            ? previous.conversations
            : {
                ...previous.conversations,
                conversations: [
                  toConversationSummary(conversation),
                  ...previous.conversations.conversations.filter(
                    (entry) => entry.conversation_id !== conversation.conversation_id,
                  ),
                ],
              },
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
    },
    updateActiveMessages: (messages: typeof activeConversation.messages) => {
      setState((previous) => {
        const conversation = previous.active.conversation;
        if (!conversation) {
          return previous;
        }
        const nextConversation = {
          ...conversation,
          messages,
          message_count: messages.length,
          last_message: buildLastMessage(messages),
          updated_at: "2026-03-08T00:00:01.000Z",
        };
        return {
          ...previous,
          conversations: {
            ...previous.conversations,
            conversations: [
              toConversationSummary(nextConversation),
              ...previous.conversations.conversations.filter(
                (entry) => entry.conversation_id !== nextConversation.conversation_id,
              ),
            ],
          },
          active: {
            ...previous.active,
            conversation: nextConversation,
          },
        };
      });
    },
  };
}
