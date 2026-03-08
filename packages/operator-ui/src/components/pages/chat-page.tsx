import type { OperatorCore } from "@tyrum/operator-core";
import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { cn } from "../../lib/cn.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Separator } from "../ui/separator.js";
import { Textarea } from "../ui/textarea.js";

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

function deriveThreadTitle(session: {
  thread_id: string;
  last_turn?: { role: string; content: string } | undefined;
}): string {
  const last = session.last_turn;
  const line = last ? firstLine(last.content) : "";
  if (line) return line;
  return session.thread_id;
}

function deriveThreadPreview(session: {
  summary: string;
  last_turn?: { role: string; content: string } | undefined;
}): string {
  const summary = firstLine(session.summary);
  if (summary) return summary;

  const lines = (session.last_turn?.content ?? "").split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

interface ChatThreadSummary {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  last_turn?: { role: string; content: string } | undefined;
  created_at: string;
  updated_at: string;
  title: string;
  preview: string;
}

function ChatToolbar({
  agentId,
  agents,
  disabled,
  onAgentChange,
  onNewChat,
}: {
  agentId: string;
  agents: Array<{ agent_id: string }>;
  disabled: boolean;
  onAgentChange: (value: string) => void;
  onNewChat: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Chat</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="chat-agent-select"
          aria-label="Agent"
          value={agentId}
          disabled={disabled}
          onChange={(event) => {
            onAgentChange(event.currentTarget.value);
          }}
          className="flex h-9 min-w-56 rounded-lg border border-border bg-bg px-3 py-1 text-sm text-fg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
        >
          {agents.length === 0 ? (
            <option value={agentId}>{agentId}</option>
          ) : (
            agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.agent_id}
              </option>
            ))
          )}
        </select>
        <Button size="sm" data-testid="chat-new" disabled={disabled} onClick={onNewChat}>
          New chat
        </Button>
      </div>
    </div>
  );
}

function ChatThreadsPanel({
  connected,
  loading,
  errorMessage,
  threads,
  activeSessionId,
  onRefresh,
  onLoadMore,
  canLoadMore,
  onOpenThread,
}: {
  connected: boolean;
  loading: boolean;
  errorMessage: string | null;
  threads: ChatThreadSummary[];
  activeSessionId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
  onOpenThread: (sessionId: string) => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col" data-testid="chat-threads-panel">
      <CardHeader className="pb-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-fg">Threads</h2>
          <Button
            size="sm"
            variant="secondary"
            data-testid="chat-refresh-sessions"
            disabled={!connected || loading}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {errorMessage ? (
          <Alert variant="error" title="Failed to load sessions" description={errorMessage} />
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && threads.length === 0 ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="text-sm text-fg-muted">No chats yet.</div>
          ) : (
            <ScrollArea className="h-full">
              <div className="grid gap-1.5 pr-2">
                {threads.map((session) => {
                  const isActive = activeSessionId === session.session_id;
                  return (
                    <button
                      key={session.session_id}
                      type="button"
                      data-testid={`chat-thread-${session.session_id}`}
                      data-active={isActive ? "true" : undefined}
                      className={cn(
                        "w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                        isActive
                          ? "border-border bg-bg-subtle"
                          : "border-border bg-bg hover:bg-bg-subtle",
                      )}
                      onClick={() => {
                        onOpenThread(session.session_id);
                      }}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-fg break-words [overflow-wrap:anywhere]">
                            {session.title}
                          </div>
                          <div className="mt-1 text-xs text-fg-muted break-words [overflow-wrap:anywhere]">
                            {session.preview || "—"}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-fg-muted">
                          {formatRelativeTime(session.updated_at)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button
          size="sm"
          variant="secondary"
          data-testid="chat-load-more"
          disabled={!canLoadMore || loading}
          onClick={onLoadMore}
        >
          Load more
        </Button>
        <div className="text-xs text-fg-muted">{threads.length} threads</div>
      </CardFooter>
    </Card>
  );
}

function ChatConversationPanel({
  activeThreadId,
  activeTurns,
  loadError,
  sendError,
  deleteDisabled,
  onDelete,
  draft,
  setDraft,
  send,
  sendBusy,
  canSend,
  onBack,
}: {
  activeThreadId: string | null;
  activeTurns: Array<{ role: string; content: string }>;
  loadError: string | null;
  sendError: string | null;
  deleteDisabled: boolean;
  onDelete: () => void;
  draft: string;
  setDraft: (value: string) => void;
  send: () => Promise<void>;
  sendBusy: boolean;
  canSend: boolean;
  onBack?: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col" data-testid="chat-conversation-panel">
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {onBack ? (
                <Button size="sm" variant="ghost" data-testid="chat-back" onClick={onBack}>
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              ) : null}
              <h2 className="text-base font-semibold text-fg">Conversation</h2>
            </div>
            <div className="mt-2 text-xs text-fg-muted break-all">
              {activeThreadId ?? "Select a thread to view transcript."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              data-testid="chat-delete"
              disabled={deleteDisabled}
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {loadError ? (
          <Alert variant="error" title="Failed to load transcript" description={loadError} />
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full" data-testid="chat-transcript">
            <div className="grid gap-3 pr-2">
              {activeTurns.length === 0 ? (
                <div className="text-sm text-fg-muted">
                  {activeThreadId ? "No messages yet." : "Pick a thread or start a new chat."}
                </div>
              ) : (
                activeTurns.map((turn, index) => {
                  const isUser = turn.role === "user";
                  return (
                    <div
                      key={`${turn.role}-${index}`}
                      className={cn("grid", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "w-fit max-w-full rounded-lg border px-3 py-2.5 text-sm whitespace-pre-wrap md:max-w-[42rem]",
                          isUser
                            ? "border-border bg-bg-subtle text-fg"
                            : "border-border bg-bg text-fg",
                        )}
                      >
                        <div className="mb-1 text-xs text-fg-muted">
                          {isUser ? "You" : "Assistant"}
                        </div>
                        <div className="break-words [overflow-wrap:anywhere]">{turn.content}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="flex-col items-stretch gap-2.5">
        {sendError ? (
          <Alert variant="error" title="Failed to send" description={sendError} />
        ) : null}
        <Textarea
          data-testid="chat-composer"
          aria-label="Message"
          placeholder={activeThreadId ? "Type a message…" : "Select a thread first."}
          value={draft}
          disabled={!activeThreadId || sendBusy}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (event.shiftKey) return;
            event.preventDefault();
            void send();
          }}
          className="min-h-20"
        />
        <div className="flex items-center justify-end">
          <Button
            data-testid="chat-send"
            disabled={!canSend}
            isLoading={sendBusy}
            onClick={() => {
              void send();
            }}
          >
            Send
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function ChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const chat = useOperatorStore(core.chatStore);
  const lgUp = useMediaQuery("(min-width: 1024px)");

  const [draft, setDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"threads" | "conversation">("threads");

  const threads = useMemo(() => {
    return chat.sessions.sessions.map((session) => ({
      ...session,
      title: deriveThreadTitle(session),
      preview: deriveThreadPreview(session),
    }));
  }, [chat.sessions.sessions]);

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshAgents();
  }, [core.chatStore, isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshSessions();
  }, [core.chatStore, isConnected, chat.agentId]);

  useEffect(() => {
    if (lgUp) return;
    if (!chat.active.sessionId) {
      setMobileView("threads");
    }
  }, [chat.active.sessionId, lgUp]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    await core.chatStore.sendMessage(text);
    if (!core.chatStore.getSnapshot().send.error) {
      setDraft("");
    }
  };

  const openThread = async (sessionId: string): Promise<void> => {
    await core.chatStore.openSession(sessionId);
    if (!lgUp) {
      setMobileView("conversation");
    }
  };

  const startNewChat = async (): Promise<void> => {
    await core.chatStore.newChat();
    if (!lgUp) {
      setMobileView("conversation");
    }
  };

  const active = chat.active.session;
  const activeTurns = active?.turns ?? [];
  const showThreads = lgUp || mobileView === "threads";
  const showConversation = lgUp || mobileView === "conversation";
  const canSend = Boolean(active) && !chat.send.sending && draft.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5" data-testid="chat-page">
      {lgUp || mobileView === "threads" ? (
        <ChatToolbar
          agentId={chat.agentId}
          agents={chat.agents.agents}
          disabled={!isConnected || chat.agents.loading}
          onAgentChange={(value) => {
            core.chatStore.setAgentId(value);
          }}
          onNewChat={() => {
            void startNewChat();
          }}
        />
      ) : null}

      {chat.agents.error ? (
        <Alert
          variant="error"
          title="Failed to load agents"
          description={chat.agents.error.message}
        />
      ) : null}

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3",
          lgUp ? "lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-5" : null,
        )}
        data-testid="chat-panels"
      >
        {showThreads ? (
          <ChatThreadsPanel
            connected={isConnected}
            loading={chat.sessions.loading}
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
          />
        ) : null}

        {showConversation ? (
          <ChatConversationPanel
            activeThreadId={active?.thread_id ?? null}
            activeTurns={activeTurns}
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
          if (!lgUp) {
            setMobileView("threads");
          }
        }}
      />
    </div>
  );
}
