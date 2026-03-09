import { ChevronLeft, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { ScrollArea } from "../ui/scroll-area.js";

export interface ChatThreadSummary {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  title: string;
  summary: string;
  last_turn?: { role: string; content: string } | undefined;
  created_at: string;
  updated_at: string;
  preview: string;
}

export function ChatThreadsPanel({
  splitView,
  connected,
  loading,
  agentsLoading,
  errorMessage,
  threads,
  activeSessionId,
  onRefresh,
  onLoadMore,
  canLoadMore,
  onOpenThread,
  agentId,
  agents,
  onAgentChange,
  onNewChat,
}: {
  splitView: boolean;
  connected: boolean;
  loading: boolean;
  agentsLoading: boolean;
  errorMessage: string | null;
  threads: ChatThreadSummary[];
  activeSessionId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
  onOpenThread: (sessionId: string) => void;
  agentId: string;
  agents: Array<{ agent_id: string }>;
  onAgentChange: (value: string) => void;
  onNewChat: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-bg-subtle/30",
        splitView ? "w-[260px]" : "w-full",
      )}
      data-testid="chat-threads-panel"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <select
          data-testid="chat-agent-select"
          aria-label="Agent"
          value={agentId}
          disabled={!connected || agentsLoading}
          onChange={(event) => {
            onAgentChange(event.currentTarget.value);
          }}
          className="h-7 max-w-[140px] truncate rounded-md border-none bg-transparent px-1 py-0 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-0"
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
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-fg-muted hover:text-fg"
            disabled={!connected || loading}
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-fg-muted hover:text-fg"
            disabled={!connected || agentsLoading}
            onClick={onNewChat}
            title="New Chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {errorMessage ? (
          <div className="p-3">
            <Alert variant="error" title="Failed to load sessions" description={errorMessage} />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && threads.length === 0 ? (
            <div className="p-4 text-sm text-fg-muted">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-fg-muted">No chats yet.</div>
          ) : (
            <ScrollArea className="h-full">
              <div className="grid gap-0.5 p-2">
                {threads.map((session) => {
                  const isActive = activeSessionId === session.session_id;
                  return (
                    <button
                      key={session.session_id}
                      type="button"
                      data-testid={`chat-thread-${session.session_id}`}
                      data-active={isActive ? "true" : undefined}
                      className={cn(
                        "w-full rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                        isActive
                          ? "bg-bg-subtle text-fg"
                          : "bg-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg",
                      )}
                      onClick={() => {
                        onOpenThread(session.session_id);
                      }}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{session.title}</div>
                          <div className="mt-0.5 truncate text-xs opacity-80">
                            {session.preview || "—"}
                          </div>
                        </div>
                        <div className="shrink-0 text-[10px] opacity-60">
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
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-center text-xs text-fg-muted hover:text-fg"
          data-testid="chat-load-more"
          disabled={!canLoadMore || loading}
          onClick={onLoadMore}
        >
          {canLoadMore ? "Load more" : `${threads.length} threads`}
        </Button>
      </div>
    </div>
  );
}

export function ChatConversationPanel({
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-bg"
      data-testid="chat-conversation-panel"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-fg-muted hover:text-fg"
              data-testid="chat-back"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <h2 className="text-sm font-medium text-fg">
            {activeThreadId ? "Conversation" : "New Chat"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-fg-muted hover:text-error"
            data-testid="chat-delete"
            disabled={deleteDisabled}
            onClick={onDelete}
            title="Delete Chat"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loadError ? (
          <div className="p-4">
            <Alert variant="error" title="Failed to load transcript" description={loadError} />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full" data-testid="chat-transcript">
            <div className="flex flex-col gap-4 p-4">
              {activeTurns.length === 0 ? (
                <div className="mt-10 flex h-full items-center justify-center text-sm text-fg-muted">
                  {activeThreadId ? "No messages yet." : "Pick a thread or start a new chat."}
                </div>
              ) : (
                activeTurns.map((turn, index) => {
                  const isUser = turn.role === "user";
                  return (
                    <div
                      key={`${turn.role}-${index}`}
                      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap md:max-w-[75%]",
                          isUser ? "bg-fg text-bg" : "border border-border bg-bg-subtle text-fg",
                        )}
                      >
                        <div className="break-words [overflow-wrap:anywhere]">{turn.content}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-bg-subtle/30 px-4 py-3">
        <div className="mx-auto max-w-4xl">
          {sendError ? (
            <div className="mb-3">
              <Alert variant="error" title="Failed to send" description={sendError} />
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={composerRef}
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
              className="min-h-[36px] max-h-[120px] flex-1 resize-none border-0 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              rows={1}
            />
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "mb-0.5 h-7 w-7 shrink-0 rounded-md p-0",
                canSend ? "text-fg hover:text-primary" : "text-fg-muted/50",
              )}
              data-testid="chat-send"
              disabled={!canSend}
              isLoading={sendBusy}
              onClick={() => {
                void send();
              }}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
