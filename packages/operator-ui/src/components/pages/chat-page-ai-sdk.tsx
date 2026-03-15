import {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
  type TyrumAiSdkChatSession,
  type TyrumAiSdkChatSessionSummary,
} from "@tyrum/client";
import type { OperatorCore, ResolveApprovalInput } from "@tyrum/operator-core";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBrowserNodeOptional } from "../../browser-node/browser-node-provider.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { Alert } from "../ui/alert.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Spinner } from "../ui/spinner.js";
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { ChatThreadsPanel } from "./chat-page-threads.js";
import { AiSdkConversation } from "./chat-page-ai-sdk-conversation.js";
import {
  applySessionMessages,
  buildPreview,
  patchSessionList,
  toThreadSummary,
} from "./chat-page-ai-sdk-shared.js";
import type { ReasoningDisplayMode } from "./chat-page-ai-sdk-types.js";

const CHAT_TWO_PANEL_CONTENT_WIDTH_PX = 800;

type ChatAgentOption = {
  agent_id: string;
  label: string;
};

function formatChatAgentLabel(input: {
  agent_id: string;
  agent_key?: string;
  persona?: { name?: string };
}): string {
  const agentId = input.agent_id.trim();
  const agentKey = input.agent_key?.trim() ?? "";
  const displayName = input.persona?.name?.trim() || agentKey || agentId;
  if (!agentKey || displayName === agentKey) {
    return displayName;
  }
  return `${displayName} (${agentKey})`;
}

function normalizeChatAgentOptions(
  input: Array<{
    agent_id: string;
    agent_key?: string;
    persona?: { name?: string };
  }>,
): ChatAgentOption[] {
  const byId = new Map<string, ChatAgentOption>();
  for (const agent of input) {
    const agentId = agent.agent_id.trim();
    if (!agentId || byId.has(agentId)) {
      continue;
    }
    byId.set(agentId, {
      agent_id: agentId,
      label: formatChatAgentLabel(agent),
    });
  }
  return [...byId.values()];
}

type SessionListState = {
  error: string | null;
  loading: boolean;
  nextCursor: string | null;
  sessions: TyrumAiSdkChatSessionSummary[];
};

type ActiveSessionState = {
  error: string | null;
  loading: boolean;
  session: TyrumAiSdkChatSession | null;
  sessionId: string | null;
};

export function AiSdkChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const lgUp = useAppShellMinWidth(CHAT_TWO_PANEL_CONTENT_WIDTH_PX);
  const browserNode = useBrowserNodeOptional();
  const host = useHostApiOptional();

  const socket = useMemo(() => (supportsTyrumAiSdkChatSocket(core.ws) ? core.ws : null), [core.ws]);
  const sessionClient = useMemo(
    () => (socket ? createTyrumAiSdkChatSessionClient({ client: socket }) : null),
    [socket],
  );
  const transport = useMemo(
    () => (socket ? createTyrumAiSdkChatTransport({ client: socket }) : null),
    [socket],
  );

  const [agents, setAgents] = useState<ChatAgentOption[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentId, setAgentId] = useState("default");
  const [sessions, setSessions] = useState<SessionListState>({
    error: null,
    loading: false,
    nextCursor: null,
    sessions: [],
  });
  const [active, setActive] = useState<ActiveSessionState>({
    error: null,
    loading: false,
    session: null,
    sessionId: null,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "threads">("threads");
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [reasoningMode, setReasoningMode] = useState<ReasoningDisplayMode>("collapsed");
  const [resolvingApproval, setResolvingApproval] = useState<{
    approvalId: string;
    state: "always" | "approved" | "denied";
  } | null>(null);

  const isConnected = connection.status === "connected";
  const threads = useMemo(() => sessions.sessions.map(toThreadSummary), [sessions.sessions]);
  const activeSession = active.session;

  useEffect(() => {
    if (!lgUp && !active.sessionId) {
      setMobileView("threads");
    }
  }, [active.sessionId, lgUp]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let cancelled = false;
    setAgentsLoading(true);
    void core.http.agents
      .list()
      .then((result) => {
        if (cancelled) {
          return;
        }
        const nextAgents = normalizeChatAgentOptions(result.agents);
        setAgents(nextAgents);
        const firstAgent = nextAgents[0];
        if (firstAgent) {
          setAgentId((current) =>
            nextAgents.some((agent) => agent.agent_id === current) ? current : firstAgent.agent_id,
          );
        }
        setAgentsError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setAgentsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAgentsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [core.http.agents, isConnected]);

  const refreshSessions = useCallback(
    async (cursor?: string): Promise<void> => {
      if (!sessionClient) {
        return;
      }
      setSessions((current) => ({ ...current, error: null, loading: true }));
      try {
        const result = await sessionClient.list({
          agent_id: agentId,
          cursor,
          limit: 50,
        });
        setSessions((current) => ({
          error: null,
          loading: false,
          nextCursor: result.next_cursor ?? null,
          sessions: cursor ? [...current.sessions, ...result.sessions] : result.sessions,
        }));
      } catch (error) {
        setSessions((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        }));
      }
    },
    [agentId, sessionClient],
  );

  useEffect(() => {
    if (!isConnected || !sessionClient) {
      return;
    }
    void refreshSessions();
  }, [isConnected, refreshSessions, sessionClient]);

  const openSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionClient) {
        return;
      }
      setActive({
        error: null,
        loading: true,
        session: null,
        sessionId,
      });
      try {
        const session = await sessionClient.get({ session_id: sessionId });
        setActive({
          error: null,
          loading: false,
          session,
          sessionId,
        });
        if (!lgUp) {
          setMobileView("conversation");
        }
      } catch (error) {
        setActive({
          error: error instanceof Error ? error.message : String(error),
          loading: false,
          session: null,
          sessionId,
        });
      }
    },
    [lgUp, sessionClient],
  );

  useEffect(() => {
    if (!lgUp || active.sessionId || active.loading) {
      return;
    }
    const firstSession = sessions.sessions[0];
    if (!firstSession) {
      return;
    }
    void openSession(firstSession.session_id);
  }, [active.loading, active.sessionId, lgUp, openSession, sessions.sessions]);

  const startNewChat = useCallback(async (): Promise<void> => {
    if (!sessionClient) {
      return;
    }
    try {
      const session = await sessionClient.create({ agent_id: agentId });
      setSessions((current) => ({
        ...current,
        sessions: patchSessionList(current.sessions, session),
      }));
      setActive({
        error: null,
        loading: false,
        session,
        sessionId: session.session_id,
      });
      if (!lgUp) {
        setMobileView("conversation");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [agentId, lgUp, sessionClient]);

  const deleteActive = useCallback(async (): Promise<void> => {
    const session = active.session;
    if (!sessionClient || !session) {
      return;
    }
    try {
      await sessionClient.delete({ session_id: session.session_id });
      setSessions((current) => ({
        ...current,
        sessions: current.sessions.filter((entry) => entry.session_id !== session.session_id),
      }));
      setActive({
        error: null,
        loading: false,
        session: null,
        sessionId: null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [active.session, sessionClient]);

  const resolveAttachedNodeId = useCallback(async (): Promise<string | null> => {
    if (browserNode?.status === "connected" && browserNode.deviceId) {
      return browserNode.deviceId;
    }
    if (host?.kind === "mobile") {
      try {
        const state = await host.api.node.getState();
        return state.status === "connected" && state.deviceId ? state.deviceId : null;
      } catch {
        return null;
      }
    }
    if (host?.kind !== "desktop") {
      return null;
    }
    const getStatus = host.api?.node.getStatus;
    if (typeof getStatus !== "function") {
      return null;
    }
    try {
      const status = await getStatus();
      return status.connected && status.deviceId ? status.deviceId : null;
    } catch {
      return null;
    }
  }, [browserNode, host]);

  const resolveApproval = useCallback(
    async (input: ResolveApprovalInput): Promise<void> => {
      setResolvingApproval({
        approvalId: input.approvalId,
        state: input.mode === "always" ? "always" : input.decision,
      });
      try {
        await core.approvalsStore.resolve(input);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setResolvingApproval(null);
      }
    },
    [core.approvalsStore],
  );

  const handleSessionMessages = useCallback((sessionId: string, messages: UIMessage[]) => {
    setActive((current) => {
      if (!current.session || current.session.session_id !== sessionId) {
        return current;
      }
      const nextSession = applySessionMessages(current.session, messages);
      return { ...current, session: nextSession };
    });
    setSessions((current) => {
      const sessionSummary = current.sessions.find((entry) => entry.session_id === sessionId);
      if (!sessionSummary) {
        return current;
      }
      const nextSession: TyrumAiSdkChatSession = {
        ...sessionSummary,
        messages,
        message_count: messages.length,
        last_message: buildPreview(messages),
        updated_at: new Date().toISOString(),
      };
      return {
        ...current,
        sessions: patchSessionList(current.sessions, nextSession),
      };
    });
  }, []);

  const handleConversationMessages = useCallback(
    (messages: UIMessage[]) => {
      if (!activeSession?.session_id) {
        return;
      }
      handleSessionMessages(activeSession.session_id, messages);
    },
    [activeSession?.session_id, handleSessionMessages],
  );

  const showThreads = lgUp || mobileView === "threads";
  const showConversation = lgUp || mobileView === "conversation";

  if (!socket || !sessionClient || !transport) {
    return (
      <div className="p-4">
        <Alert
          variant="error"
          title="AI SDK chat transport unavailable"
          description="The current WebSocket client does not expose the AI SDK chat socket hooks yet."
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-bg"
      data-testid="chat-page"
    >
      {agentsError ? (
        <div className="absolute inset-x-0 top-0 z-10 p-4">
          <Alert variant="error" title="Failed to load agents" description={agentsError} />
        </div>
      ) : null}

      <div className="flex h-full w-full min-h-0 flex-1" data-testid="chat-panels">
        {showThreads ? (
          <ChatThreadsPanel
            splitView={lgUp}
            connected={isConnected}
            loading={sessions.loading}
            agentsLoading={agentsLoading}
            errorMessage={sessions.error}
            threads={threads}
            activeSessionId={active.sessionId}
            onRefresh={() => {
              void refreshSessions();
            }}
            onLoadMore={() => {
              if (!sessions.nextCursor) {
                return;
              }
              void refreshSessions(sessions.nextCursor);
            }}
            canLoadMore={Boolean(sessions.nextCursor)}
            onOpenThread={(sessionId) => {
              void openSession(sessionId);
            }}
            agentId={agentId}
            agents={agents}
            onAgentChange={(value) => {
              setAgentId(value);
            }}
            onNewChat={() => {
              void startNewChat();
            }}
          />
        ) : null}

        {showConversation ? (
          active.loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : activeSession ? (
            <AiSdkConversation
              key={activeSession.session_id}
              approvalsById={approvals.byId}
              core={core}
              onBack={
                lgUp
                  ? undefined
                  : () => {
                      setMobileView("threads");
                    }
              }
              onDelete={() => {
                setDeleteOpen(true);
              }}
              onResolveApproval={(input) => {
                void resolveApproval(input);
              }}
              onRenderModeChange={setRenderMode}
              onReasoningModeChange={setReasoningMode}
              onSessionMessages={handleConversationMessages}
              renderMode={renderMode}
              resolvingApproval={resolvingApproval}
              resolveAttachedNodeId={resolveAttachedNodeId}
              reasoningMode={reasoningMode}
              session={activeSession}
              sessionClient={sessionClient}
              transport={transport}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6">
              {active.error ? (
                <Alert
                  variant="error"
                  title="Failed to load conversation"
                  description={active.error}
                />
              ) : (
                <div className="grid max-w-sm justify-items-center gap-3 text-center">
                  <div className="text-sm text-fg-muted">
                    Select a conversation or start a new chat.
                  </div>
                  <button
                    type="button"
                    data-testid="chat-empty-conversation-new"
                    className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    onClick={() => {
                      void startNewChat();
                    }}
                  >
                    Start new chat
                  </button>
                </div>
              )}
            </div>
          )
        ) : null}
      </div>

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this chat?"
        description="This removes the session and its message history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteActive();
          if (!lgUp) {
            setMobileView("threads");
          }
        }}
      />
    </div>
  );
}
