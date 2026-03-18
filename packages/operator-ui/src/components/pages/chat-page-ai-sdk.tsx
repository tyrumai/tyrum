import {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
} from "@tyrum/client";
import type { OperatorCore, ResolveApprovalInput } from "@tyrum/operator-core";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBrowserNodeOptional } from "../../browser-node/browser-node-provider.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { LoadingState } from "../ui/loading-state.js";
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { ChatThreadsPanel } from "./chat-page-threads.js";
import { AiSdkConversation } from "./chat-page-ai-sdk-conversation.js";
import { toThreadSummary } from "./chat-page-ai-sdk-shared.js";

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

export function AiSdkChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const chat = useOperatorStore(core.chatStore);
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

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "threads">("threads");
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [resolvingApproval, setResolvingApproval] = useState<{
    approvalId: string;
    state: "always" | "approved" | "denied";
  } | null>(null);

  const isConnected = connection.status === "connected";
  const agents = useMemo(() => normalizeChatAgentOptions(chat.agents.agents), [chat.agents.agents]);
  const threads = useMemo(
    () => chat.sessions.sessions.map(toThreadSummary),
    [chat.sessions.sessions],
  );
  const archivedThreads = useMemo(
    () => chat.archivedSessions.sessions.map(toThreadSummary),
    [chat.archivedSessions.sessions],
  );
  const activeSession = chat.active.session;
  const sessionsError = chat.sessions.error?.message ?? null;
  const agentsError = chat.agents.error?.message ?? null;
  const activeError = chat.active.error?.message ?? null;

  useEffect(() => {
    if (!lgUp && !chat.active.sessionId) {
      setMobileView("threads");
    }
  }, [chat.active.sessionId, lgUp]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void core.chatStore.refreshAgents({ includeDefault: true });
  }, [core.chatStore, isConnected]);

  useEffect(() => {
    const firstAgent = chat.agents.agents[0];
    if (!firstAgent) {
      return;
    }
    if (chat.agents.agents.some((agent) => agent.agent_id === chat.agentId)) {
      return;
    }
    core.chatStore.setAgentId(firstAgent.agent_id);
  }, [chat.agentId, chat.agents.agents, core.chatStore]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void core.chatStore.refreshSessions();
  }, [chat.agentId, core.chatStore, isConnected]);

  useEffect(() => {
    if (!lgUp || chat.active.sessionId || chat.active.loading) {
      return;
    }
    const firstSession = chat.sessions.sessions[0];
    if (!firstSession) {
      return;
    }
    void core.chatStore.openSession(firstSession.session_id);
  }, [chat.active.loading, chat.active.sessionId, chat.sessions.sessions, core.chatStore, lgUp]);

  const startNewChat = useCallback(async (): Promise<void> => {
    await core.chatStore.newChat();
    const next = core.chatStore.getSnapshot();
    if (next.sessions.error) {
      toast.error(next.sessions.error.message);
      return;
    }
    if (!lgUp && next.active.sessionId) {
      setMobileView("conversation");
    }
  }, [core.chatStore, lgUp]);

  const deleteActive = useCallback(async (): Promise<void> => {
    const sessionId = core.chatStore.getSnapshot().active.sessionId;
    if (!sessionId) {
      return;
    }
    await core.chatStore.deleteActive();
    const next = core.chatStore.getSnapshot().active;
    if (next.sessionId === sessionId && next.error) {
      toast.error(next.error.message);
    }
  }, [core.chatStore]);

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

  const handleSessionMessages = useCallback(
    (sessionId: string, messages: UIMessage[]) => {
      if (core.chatStore.getSnapshot().active.sessionId !== sessionId) {
        return;
      }
      core.chatStore.updateActiveMessages(messages);
    },
    [core.chatStore],
  );

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
            loading={chat.sessions.loading}
            agentsLoading={chat.agents.loading}
            errorMessage={sessionsError}
            threads={threads}
            activeSessionId={chat.active.sessionId}
            onRefresh={() => {
              void core.chatStore.refreshSessions();
            }}
            onLoadMore={() => {
              void core.chatStore.loadMoreSessions();
            }}
            canLoadMore={Boolean(chat.sessions.nextCursor)}
            onOpenThread={(sessionId) => {
              const isArchived = chat.archivedSessions.sessions.some(
                (s) => s.session_id === sessionId,
              );
              const open = async () => {
                if (isArchived) {
                  await core.chatStore.unarchiveSession(sessionId);
                }
                await core.chatStore.openSession(sessionId);
                if (!lgUp && core.chatStore.getSnapshot().active.sessionId === sessionId) {
                  setMobileView("conversation");
                }
              };
              void open();
            }}
            agentId={chat.agentId}
            agents={agents}
            onAgentChange={(value) => {
              core.chatStore.setAgentId(value);
            }}
            onNewChat={() => {
              void startNewChat();
            }}
            archivedThreads={archivedThreads}
            archivedLoading={chat.archivedSessions.loading}
            archivedLoaded={chat.archivedSessions.loaded}
            archivedHasError={Boolean(chat.archivedSessions.error)}
            canLoadMoreArchived={Boolean(chat.archivedSessions.nextCursor)}
            onArchiveThread={(sessionId) => {
              void core.chatStore.archiveSession(sessionId);
            }}
            onUnarchiveThread={(sessionId) => {
              void core.chatStore.unarchiveSession(sessionId);
            }}
            onLoadArchived={() => {
              void core.chatStore.loadArchivedSessions();
            }}
            onLoadMoreArchived={() => {
              void core.chatStore.loadMoreArchivedSessions();
            }}
          />
        ) : null}

        {showConversation ? (
          chat.active.loading ? (
            <LoadingState variant="centered" className="flex-1" />
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
              onSessionMessages={handleConversationMessages}
              renderMode={renderMode}
              resolvingApproval={resolvingApproval}
              resolveAttachedNodeId={resolveAttachedNodeId}
              session={activeSession}
              sessionClient={sessionClient}
              transport={transport}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6">
              {activeError ? (
                <Alert
                  variant="error"
                  title="Failed to load conversation"
                  description={activeError}
                />
              ) : (
                <div className="grid max-w-sm justify-items-center gap-3 text-center">
                  <div className="text-sm text-fg-muted">
                    Select a conversation or start a new chat.
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="chat-empty-conversation-new"
                    onClick={() => {
                      void startNewChat();
                    }}
                  >
                    Start new chat
                  </Button>
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
          if (!lgUp && !core.chatStore.getSnapshot().active.sessionId) {
            setMobileView("threads");
          }
        }}
      />
    </div>
  );
}
