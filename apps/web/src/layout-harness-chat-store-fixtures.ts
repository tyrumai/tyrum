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

  const activeSession = {
    session_id: "session-1",
    agent_id: "default",
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

  const toSessionSummary = (session: typeof activeSession) => ({
    agent_id: session.agent_id,
    session_id: session.session_id,
    channel: session.channel,
    thread_id: session.thread_id,
    title: session.title,
    message_count: session.message_count,
    last_message: session.last_message,
    created_at: session.created_at,
    updated_at: session.updated_at,
  });

  const buildLastMessage = (messages: typeof activeSession.messages) => {
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
    agentId: "default",
    agents: {
      agents: [{ agent_id: "default" }, { agent_id: "agent-1" }],
      loading: false,
      error: null,
    },
    sessions: {
      sessions: [toSessionSummary(activeSession)],
      nextCursor: null,
      loading: false,
      error: null,
    },
    archivedSessions: {
      sessions: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: {
      sessionId: activeSession.session_id,
      session: activeSession,
      loading: false,
      error: null,
    },
  });

  return {
    ...store,
    setAgentId(agentId: string) {
      setState((previous) => ({ ...previous, agentId }));
    },
    refreshAgents: async () => {},
    refreshSessions: async () => {},
    loadMoreSessions: async () => {},
    openSession: async (sessionId: string) => {
      setState((previous) => ({
        ...previous,
        active: {
          ...previous.active,
          sessionId,
          session: activeSession,
        },
      }));
    },
    newChat: async () => {},
    deleteActive: async () => {},
    archiveSession: async () => {},
    unarchiveSession: async () => {},
    loadArchivedSessions: async () => {},
    loadMoreArchivedSessions: async () => {},
    hydrateActiveSession: (session: typeof activeSession | null) => {
      setState((previous) => ({
        ...previous,
        sessions:
          session === null
            ? previous.sessions
            : {
                ...previous.sessions,
                sessions: [
                  toSessionSummary(session),
                  ...previous.sessions.sessions.filter(
                    (entry) => entry.session_id !== session.session_id,
                  ),
                ],
              },
        active:
          session === null
            ? {
                sessionId: null,
                session: null,
                loading: false,
                error: null,
              }
            : {
                sessionId: session.session_id,
                session,
                loading: false,
                error: null,
              },
      }));
    },
    updateActiveMessages: (messages: typeof activeSession.messages) => {
      setState((previous) => {
        const session = previous.active.session;
        if (!session) {
          return previous;
        }
        const nextSession = {
          ...session,
          messages,
          message_count: messages.length,
          last_message: buildLastMessage(messages),
          updated_at: "2026-03-08T00:00:01.000Z",
        };
        return {
          ...previous,
          sessions: {
            ...previous.sessions,
            sessions: [
              toSessionSummary(nextSession),
              ...previous.sessions.sessions.filter(
                (entry) => entry.session_id !== nextSession.session_id,
              ),
            ],
          },
          active: {
            ...previous.active,
            session: nextSession,
          },
        };
      });
    },
  };
}
