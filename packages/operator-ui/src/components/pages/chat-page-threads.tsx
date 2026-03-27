import { Archive, ArchiveRestore, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  translateString,
  translateStringAttribute,
  useI18n,
  useTranslateNode,
} from "../../i18n-helpers.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";

export interface ChatThreadSummary {
  agent_key: string;
  conversation_id: string;
  channel: string;
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string;
  archived: boolean;
}

export function ChatThreadsPanel({
  splitView,
  connected,
  loading,
  agentsLoading,
  errorMessage,
  threads,
  activeConversationId,
  onRefresh,
  onLoadMore,
  canLoadMore,
  onOpenThread,
  agentKey,
  agents,
  onAgentChange,
  onNewChat,
  archivedThreads,
  archivedLoading,
  archivedLoaded,
  archivedHasError,
  canLoadMoreArchived,
  onArchiveThread,
  onUnarchiveThread,
  onLoadArchived,
  onLoadMoreArchived,
}: {
  splitView: boolean;
  connected: boolean;
  loading: boolean;
  agentsLoading: boolean;
  errorMessage: string | null;
  threads: ChatThreadSummary[];
  activeConversationId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
  onOpenThread: (conversationId: string) => void;
  agentKey: string;
  agents: Array<{ agent_key: string; label: string }>;
  onAgentChange: (value: string) => void;
  onNewChat: () => void;
  archivedThreads: ChatThreadSummary[];
  archivedLoading: boolean;
  archivedLoaded: boolean;
  archivedHasError: boolean;
  canLoadMoreArchived: boolean;
  onArchiveThread: (conversationId: string) => void;
  onUnarchiveThread: (conversationId: string) => void;
  onLoadArchived: () => void;
  onLoadMoreArchived: () => void;
}) {
  const intl = useI18n();
  const translateNode = useTranslateNode();
  const [errorDismissed, setErrorDismissed] = useState(false);

  useEffect(() => {
    setErrorDismissed(false);
  }, [errorMessage]);

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
          aria-label={translateStringAttribute(intl, "Agent")}
          value={agentKey}
          disabled={!connected || agentsLoading}
          onChange={(event) => onAgentChange(event.currentTarget.value)}
          className="h-7 max-w-[140px] truncate rounded-md border-none bg-transparent px-1 py-0 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
        >
          {agents.length === 0 ? (
            <option value={agentKey}>{agentKey}</option>
          ) : (
            agents.map((agent) => (
              <option key={agent.agent_key} value={agent.agent_key}>
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
        {errorMessage && !errorDismissed ? (
          <div className="p-3">
            <Alert
              variant="error"
              title="Failed to load conversations"
              description={errorMessage}
              onDismiss={() => setErrorDismissed(true)}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && threads.length === 0 ? (
            <LoadingState className="p-4" />
          ) : (
            <ScrollArea className="h-full">
              {threads.length === 0 ? (
                <div className="grid gap-3 p-4">
                  <div className="text-sm text-fg-muted">{translateNode("No chats yet.")}</div>
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
                <>
                  <div className="grid gap-0.5 p-2">
                    {threads.map((conversation) => (
                      <ThreadItem
                        key={conversation.conversation_id}
                        conversation={conversation}
                        isActive={activeConversationId === conversation.conversation_id}
                        onOpen={onOpenThread}
                        actionIcon="archive"
                        onAction={onArchiveThread}
                      />
                    ))}
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
                </>
              )}
              <ArchivedSection
                threads={archivedThreads}
                loading={archivedLoading}
                loaded={archivedLoaded}
                hasError={archivedHasError}
                canLoadMore={canLoadMoreArchived}
                activeConversationId={activeConversationId}
                onExpand={onLoadArchived}
                onLoadMore={onLoadMoreArchived}
                onOpenThread={onOpenThread}
                onUnarchiveThread={onUnarchiveThread}
              />
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadItem({
  conversation,
  isActive,
  onOpen,
  actionIcon,
  onAction,
}: {
  conversation: ChatThreadSummary;
  isActive: boolean;
  onOpen: (conversationId: string) => void;
  actionIcon: "archive" | "restore";
  onAction: (conversationId: string) => void;
}) {
  const intl = useI18n();
  return (
    <button
      type="button"
      data-testid={`chat-thread-${conversation.conversation_id}`}
      data-active={isActive ? "true" : undefined}
      className={cn(
        "group w-full rounded-md px-2.5 py-2 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        isActive
          ? "bg-bg-subtle text-fg"
          : "bg-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg",
      )}
      onClick={() => onOpen(conversation.conversation_id)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{conversation.title}</div>
          <div className="mt-0.5 truncate text-xs opacity-80">
            {conversation.preview ||
              (conversation.message_count > 0 ? translateString(intl, "Attachment") : "\u2014")}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <span className="text-[10px] opacity-60 md:group-hover:hidden">
            {formatRelativeTime(conversation.updated_at)}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded text-fg-muted hover:text-fg md:hidden md:group-hover:flex"
            title={translateStringAttribute(intl, actionIcon === "archive" ? "Archive" : "Restore")}
            onClick={(e) => {
              e.stopPropagation();
              onAction(conversation.conversation_id);
            }}
          >
            {actionIcon === "archive" ? (
              <Archive className="h-3.5 w-3.5" />
            ) : (
              <ArchiveRestore className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </button>
  );
}

function ArchivedSection({
  threads,
  loading,
  loaded,
  hasError,
  canLoadMore,
  activeConversationId,
  onExpand,
  onLoadMore,
  onOpenThread,
  onUnarchiveThread,
}: {
  threads: ChatThreadSummary[];
  loading: boolean;
  loaded: boolean;
  hasError: boolean;
  canLoadMore: boolean;
  activeConversationId: string | null;
  onExpand: () => void;
  onLoadMore: () => void;
  onOpenThread: (conversationId: string) => void;
  onUnarchiveThread: (conversationId: string) => void;
}) {
  const translateNode = useTranslateNode();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && !loaded && !loading && !hasError) {
      onExpand();
    }
  }, [expanded, loaded, loading, hasError, onExpand]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      onExpand();
    }
  };

  return (
    <div className="border-t border-border">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg"
        onClick={handleToggle}
        data-testid="chat-archived-toggle"
        aria-expanded={expanded}
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", !expanded && "-rotate-90")} />
        {translateNode("Archived")}
      </button>
      {expanded ? (
        <div className="grid gap-0.5 px-2 pb-2">
          {loading && threads.length === 0 ? (
            <LoadingState className="py-2" />
          ) : threads.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-fg-muted">
              {translateNode("No archived chats.")}
            </div>
          ) : (
            threads.map((conversation) => (
              <ThreadItem
                key={conversation.conversation_id}
                conversation={conversation}
                isActive={activeConversationId === conversation.conversation_id}
                onOpen={onOpenThread}
                actionIcon="restore"
                onAction={onUnarchiveThread}
              />
            ))
          )}
          {canLoadMore ? (
            <Button
              variant="ghost"
              className="w-full text-xs text-fg-muted hover:text-fg"
              onClick={onLoadMore}
            >
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
