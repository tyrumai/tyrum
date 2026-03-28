import {
  createTyrumAiSdkChatConversationClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
  type OperatorCore,
  type ResolveApprovalInput,
} from "@tyrum/operator-app";
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
  agent_key: string;
  label: string;
};

function formatChatAgentLabel(input: { agent_key: string; persona?: { name?: string } }): string {
  const agentKey = input.agent_key.trim();
  const displayName = input.persona?.name?.trim() || agentKey;
  if (displayName === agentKey) {
    return displayName;
  }
  return `${displayName} (${agentKey})`;
}

function normalizeChatAgentOptions(
  input: Array<{
    agent_key: string;
    persona?: { name?: string };
  }>,
): ChatAgentOption[] {
  const byKey = new Map<string, ChatAgentOption>();
  for (const agent of input) {
    const agentKey = agent.agent_key.trim();
    if (!agentKey || byKey.has(agentKey)) {
      continue;
    }
    byKey.set(agentKey, {
      agent_key: agentKey,
      label: formatChatAgentLabel(agent),
    });
  }
  return [...byKey.values()];
}

export function AiSdkChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const chat = useOperatorStore(core.chatStore);
  const lgUp = useAppShellMinWidth(CHAT_TWO_PANEL_CONTENT_WIDTH_PX);
  const browserNode = useBrowserNodeOptional();
  const host = useHostApiOptional();

  const socket = useMemo(
    () => (supportsTyrumAiSdkChatSocket(core.chatSocket) ? core.chatSocket : null),
    [core.chatSocket],
  );
  const conversationClient = useMemo(
    () => (socket ? createTyrumAiSdkChatConversationClient({ client: socket }) : null),
    [socket],
  );
  const transport = useMemo(
    () => (socket ? createTyrumAiSdkChatTransport({ client: socket }) : null),
    [socket],
  );

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "threads">("threads");
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [toolSchemasById, setToolSchemasById] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const [resolvingApproval, setResolvingApproval] = useState<{
    approvalId: string;
    state: "always" | "approved" | "denied";
  } | null>(null);

  const isConnected = connection.status === "connected";
  const agents = useMemo(() => normalizeChatAgentOptions(chat.agents.agents), [chat.agents.agents]);
  const threads = useMemo(
    () => chat.conversations.conversations.map(toThreadSummary),
    [chat.conversations.conversations],
  );
  const archivedThreads = useMemo(
    () => chat.archivedConversations.conversations.map(toThreadSummary),
    [chat.archivedConversations.conversations],
  );
  const activeConversation = chat.active.conversation;
  const conversationsError = chat.conversations.error?.message ?? null;
  const agentsError = chat.agents.error?.message ?? null;
  const activeError = chat.active.error?.message ?? null;

  const [agentsErrorDismissed, setAgentsErrorDismissed] = useState(false);
  const [activeErrorDismissed, setActiveErrorDismissed] = useState(false);

  useEffect(() => {
    setAgentsErrorDismissed(false);
  }, [agentsError]);

  useEffect(() => {
    setActiveErrorDismissed(false);
  }, [activeError]);

  useEffect(() => {
    if (!lgUp && !chat.active.conversationId) {
      setMobileView("threads");
    }
  }, [chat.active.conversationId, lgUp]);

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
    if (chat.agents.agents.some((agent) => agent.agent_key === chat.agentKey)) {
      return;
    }
    core.chatStore.setAgentKey(firstAgent.agent_key);
  }, [chat.agentKey, chat.agents.agents, core.chatStore]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void core.chatStore.refreshConversations();
  }, [chat.agentKey, core.chatStore, isConnected]);

  useEffect(() => {
    const toolRegistryApi = core.admin.toolRegistry;
    if (!toolRegistryApi) {
      setToolSchemasById({});
      return;
    }

    let cancelled = false;
    void toolRegistryApi
      .list()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setToolSchemasById(
          Object.fromEntries(
            result.tools.flatMap((tool) =>
              tool.input_schema ? [[tool.canonical_id, tool.input_schema]] : [],
            ),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setToolSchemasById({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [core.admin.toolRegistry]);

  useEffect(() => {
    if (!lgUp || chat.active.conversationId || chat.active.loading) {
      return;
    }
    const firstConversation = chat.conversations.conversations[0];
    if (!firstConversation) {
      return;
    }
    void core.chatStore.openConversation(firstConversation.conversation_id);
  }, [
    chat.active.loading,
    chat.active.conversationId,
    chat.conversations.conversations,
    core.chatStore,
    lgUp,
  ]);

  const startNewChat = useCallback(async (): Promise<void> => {
    await core.chatStore.newChat();
    const next = core.chatStore.getSnapshot();
    if (next.conversations.error) {
      toast.error(next.conversations.error.message);
      return;
    }
    if (!lgUp && next.active.conversationId) {
      setMobileView("conversation");
    }
  }, [core.chatStore, lgUp]);

  const deleteActive = useCallback(async (): Promise<void> => {
    const conversationId = core.chatStore.getSnapshot().active.conversationId;
    if (!conversationId) {
      return;
    }
    await core.chatStore.deleteActive();
    const next = core.chatStore.getSnapshot().active;
    if (next.conversationId === conversationId && next.error) {
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

  const handleActiveConversationMessages = useCallback(
    (conversationId: string, messages: UIMessage[]) => {
      if (core.chatStore.getSnapshot().active.conversationId !== conversationId) {
        return;
      }
      core.chatStore.updateActiveMessages(messages);
    },
    [core.chatStore],
  );

  const handleConversationMessages = useCallback(
    (messages: UIMessage[]) => {
      if (!activeConversation?.conversation_id) {
        return;
      }
      handleActiveConversationMessages(activeConversation.conversation_id, messages);
    },
    [activeConversation?.conversation_id, handleActiveConversationMessages],
  );

  const showThreads = lgUp || mobileView === "threads";
  const showConversation = lgUp || mobileView === "conversation";

  if (!socket || !conversationClient || !transport) {
    return (
      <div className="p-4">
        <Alert
          variant="error"
          title="Chat unavailable"
          description="Chat is temporarily unavailable. Try reconnecting."
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-bg"
      data-testid="chat-page"
    >
      {agentsError && !agentsErrorDismissed ? (
        <div className="absolute inset-x-0 top-0 z-10 p-4">
          <Alert
            variant="error"
            title="Failed to load agents"
            description={agentsError}
            onDismiss={() => setAgentsErrorDismissed(true)}
          />
        </div>
      ) : null}

      <div className="flex h-full w-full min-h-0 flex-1" data-testid="chat-panels">
        {showThreads ? (
          <ChatThreadsPanel
            splitView={lgUp}
            connected={isConnected}
            loading={chat.conversations.loading}
            agentsLoading={chat.agents.loading}
            errorMessage={conversationsError}
            threads={threads}
            activeConversationId={chat.active.conversationId}
            onRefresh={() => {
              void core.chatStore.refreshConversations();
            }}
            onLoadMore={() => {
              void core.chatStore.loadMoreConversations();
            }}
            canLoadMore={Boolean(chat.conversations.nextCursor)}
            onOpenThread={(conversationId) => {
              const open = async () => {
                await core.chatStore.openConversation(conversationId);
                if (
                  !lgUp &&
                  core.chatStore.getSnapshot().active.conversationId === conversationId
                ) {
                  setMobileView("conversation");
                }
              };
              void open();
            }}
            agentKey={chat.agentKey}
            agents={agents}
            onAgentChange={(value) => {
              core.chatStore.setAgentKey(value);
            }}
            onNewChat={() => {
              void startNewChat();
            }}
            archivedThreads={archivedThreads}
            archivedLoading={chat.archivedConversations.loading}
            archivedLoaded={chat.archivedConversations.loaded}
            archivedHasError={Boolean(chat.archivedConversations.error)}
            canLoadMoreArchived={Boolean(chat.archivedConversations.nextCursor)}
            onArchiveThread={(conversationId) => {
              void core.chatStore.archiveConversation(conversationId);
            }}
            onUnarchiveThread={(conversationId) => {
              void core.chatStore.unarchiveConversation(conversationId);
            }}
            onLoadArchived={() => {
              void core.chatStore.loadArchivedConversations();
            }}
            onLoadMoreArchived={() => {
              void core.chatStore.loadMoreArchivedConversations();
            }}
          />
        ) : null}

        {showConversation ? (
          chat.active.loading ? (
            <LoadingState variant="centered" className="flex-1" />
          ) : activeConversation ? (
            <AiSdkConversation
              key={activeConversation.conversation_id}
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
              onConversationMessages={handleConversationMessages}
              renderMode={renderMode}
              resolvingApproval={resolvingApproval}
              resolveAttachedNodeId={resolveAttachedNodeId}
              conversation={activeConversation}
              conversationClient={conversationClient}
              toolSchemasById={toolSchemasById}
              transport={transport}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6">
              {activeError && !activeErrorDismissed ? (
                <Alert
                  variant="error"
                  title="Failed to load conversation"
                  description={activeError}
                  onDismiss={() => setActiveErrorDismissed(true)}
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
        description="This removes the conversation and its message history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteActive();
          if (!lgUp && !core.chatStore.getSnapshot().active.conversationId) {
            setMobileView("threads");
          }
        }}
      />
    </div>
  );
}
