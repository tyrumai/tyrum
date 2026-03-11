import type { OperatorCore, ResolveApprovalInput } from "@tyrum/operator-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBrowserNodeOptional } from "../../browser-node/browser-node-provider.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { Alert } from "../ui/alert.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  ChatConversationPanel,
  ChatThreadsPanel,
  deriveThreadPreview,
  deriveThreadTitle,
  type ChatThreadSummary,
  type ReasoningDisplayMode,
} from "./chat-page-parts.js";

const CHAT_TWO_PANEL_CONTENT_WIDTH_PX = 800;

export function ChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const chat = useOperatorStore(core.chatStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const lgUp = useAppShellMinWidth(CHAT_TWO_PANEL_CONTENT_WIDTH_PX);
  const browserNode = useBrowserNodeOptional();
  const host = useHostApiOptional();
  const modelConfigApi = core.http?.modelConfig;

  const [draft, setDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"threads" | "conversation">("threads");
  const [renderMode, setRenderMode] = useState<"markdown" | "text">("markdown");
  const [reasoningMode, setReasoningMode] = useState<ReasoningDisplayMode>("collapsed");
  const [resolvingApproval, setResolvingApproval] = useState<{
    approvalId: string;
    state: "approved" | "denied" | "always";
  } | null>(null);

  const threads = useMemo<ChatThreadSummary[]>(
    () =>
      chat.sessions.sessions.map((session) => ({
        ...session,
        title: deriveThreadTitle(session),
        preview: deriveThreadPreview(session),
      })),
    [chat.sessions.sessions],
  );

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshAgents();
  }, [core.chatStore, isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshSessions();
  }, [core.chatStore, isConnected, chat.agentId]);

  useEffect(() => {
    if (lgUp || chat.active.sessionId) return;
    setMobileView("threads");
  }, [chat.active.sessionId, lgUp]);

  useEffect(() => {
    if (!isConnected) return;
    if (!modelConfigApi) return;
    let cancelled = false;
    void (async () => {
      try {
        const [assignments, presets] = await Promise.all([
          modelConfigApi.listAssignments(),
          modelConfigApi.listPresets(),
        ]);
        if (cancelled) return;
        const interaction = assignments.assignments.find(
          (assignment) => assignment.execution_profile_id === "interaction",
        );
        const preset = presets.presets.find(
          (entry) => entry.preset_key === interaction?.preset_key,
        );
        const configured = preset
          ? (preset.options as Record<string, unknown>)["reasoning_visibility"]
          : undefined;
        if (configured === "hidden" || configured === "collapsed" || configured === "expanded") {
          setReasoningMode(configured);
        }
      } catch {
        // Intentional: chat still works without model-config access.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, modelConfigApi]);

  const resolveAttachedNodeId = useCallback(async (): Promise<string | null> => {
    if (browserNode?.status === "connected" && browserNode.deviceId) {
      return browserNode.deviceId;
    }
    if (host?.kind !== "desktop") return null;
    const getStatus = host.api?.node.getStatus;
    if (typeof getStatus !== "function") return null;
    try {
      const status = await getStatus();
      return status.connected && status.deviceId ? status.deviceId : null;
    } catch {
      return null;
    }
  }, [browserNode, host]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    const previousDraft = draft;
    setDraft("");
    const attachedNodeId = await resolveAttachedNodeId();
    await core.chatStore.sendMessage(text, { attachedNodeId });
    if (core.chatStore.getSnapshot().send.error) {
      setDraft((current) => (current.length === 0 ? previousDraft : current));
    }
  };

  const openThread = async (sessionId: string): Promise<void> => {
    await core.chatStore.openSession(sessionId);
    if (!lgUp) setMobileView("conversation");
  };

  const startNewChat = async (): Promise<void> => {
    await core.chatStore.newChat();
    if (!lgUp) setMobileView("conversation");
  };

  const resolveApproval = async (input: ResolveApprovalInput): Promise<void> => {
    setResolvingApproval({
      approvalId: input.approvalId,
      state: input.mode === "always" ? "always" : input.decision,
    });
    try {
      await core.approvalsStore.resolve(input);
      if (input.decision === "approved" && input.mode === "always") {
        toast.success("Always approve enabled");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingApproval(null);
    }
  };

  const active = chat.active.session;
  const showThreads = lgUp || mobileView === "threads";
  const showConversation = lgUp || mobileView === "conversation";
  const canSend = Boolean(active) && !chat.send.sending && draft.trim().length > 0;
  const working =
    chat.send.sending || chat.active.typing || chat.active.activeToolCallIds.length > 0;

  return (
    <div
      className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-bg"
      data-testid="chat-page"
    >
      {chat.agents.error ? (
        <div className="absolute inset-x-0 top-0 z-10 p-4">
          <Alert
            variant="error"
            title="Failed to load agents"
            description={chat.agents.error.message}
          />
        </div>
      ) : null}

      <div className="flex h-full w-full min-h-0 flex-1" data-testid="chat-panels">
        {showThreads ? (
          <ChatThreadsPanel
            splitView={lgUp}
            connected={isConnected}
            loading={chat.sessions.loading}
            agentsLoading={chat.agents.loading}
            errorMessage={chat.sessions.error?.message ?? null}
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
              void openThread(sessionId);
            }}
            agentId={chat.agentId}
            agents={chat.agents.agents}
            onAgentChange={(value) => {
              core.chatStore.setAgentId(value);
            }}
            onNewChat={() => {
              void startNewChat();
            }}
          />
        ) : null}

        {showConversation ? (
          <ChatConversationPanel
            activeThreadId={active?.thread_id ?? null}
            transcript={active?.transcript ?? []}
            renderMode={renderMode}
            onRenderModeChange={setRenderMode}
            reasoningMode={reasoningMode}
            onReasoningModeChange={setReasoningMode}
            loadError={chat.active.error?.message ?? null}
            sendError={chat.send.error?.message ?? null}
            deleteDisabled={!active || chat.active.loading}
            onDelete={() => {
              setDeleteOpen(true);
            }}
            draft={draft}
            setDraft={setDraft}
            send={send}
            sendBusy={chat.send.sending}
            canSend={canSend}
            working={working}
            approvalsById={approvals.byId}
            onResolveApproval={resolveApproval}
            resolvingApproval={resolvingApproval}
            onBack={
              lgUp
                ? undefined
                : () => {
                    setMobileView("threads");
                  }
            }
          />
        ) : null}
      </div>

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this chat?"
        description="This removes the session transcript and clears any related overrides. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await core.chatStore.deleteActive();
          if (!lgUp) setMobileView("threads");
        }}
      />
    </div>
  );
}
