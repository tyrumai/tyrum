import { Plus, RefreshCw } from "lucide-react";
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
  agents: Array<{ agent_id: string; label: string }>;
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
          onChange={(event) => onAgentChange(event.currentTarget.value)}
          className="h-7 max-w-[140px] truncate rounded-md border-none bg-transparent px-1 py-0 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-0"
        >
          {agents.length === 0 ? (
            <option value={agentId}>{agentId}</option>
          ) : (
            agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.label}
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
            <div className="grid gap-3 p-4">
              <div className="text-sm text-fg-muted">No chats yet.</div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="chat-empty-threads-new"
                disabled={!connected || agentsLoading}
                onClick={onNewChat}
              >
                Start new chat
              </Button>
            </div>
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
                      onClick={() => onOpenThread(session.session_id)}
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
              {canLoadMore ? (
                <div className="p-2 pt-0">
                  <Button
                    variant="ghost"
                    className="w-full text-xs text-fg-muted hover:text-fg"
                    onClick={onLoadMore}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
