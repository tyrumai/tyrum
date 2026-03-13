import type { Approval } from "@tyrum/client";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import { ChevronLeft, Send, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/cn.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { ChatThreadsPanel, type ChatThreadSummary } from "./chat-page-threads.js";
import {
  buildTranscriptDisplayItems,
  ChatApprovalItem,
  ChatReasoningItem,
  ChatTextItem,
  ChatToolItem,
  isActiveToolStatus,
  type ChatTranscriptItem,
  type ReasoningDisplayMode,
} from "./chat-page-transcript.js";

const CHAT_AUTOSCROLL_THRESHOLD_PX = 40;

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

export function deriveThreadTitle(session: { title: string; thread_id: string }): string {
  const title = firstLine(session.title);
  return title || session.thread_id;
}

export function deriveThreadPreview(session: {
  summary: string;
  last_text?: { role: string; content: string } | null;
}): string {
  const summary = firstLine(session.summary);
  return summary || firstLine(session.last_text?.content ?? "");
}

export function isBottomLocked(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTOSCROLL_THRESHOLD_PX
  );
}

export { ChatThreadsPanel, type ChatThreadSummary };
export type { ReasoningDisplayMode } from "./chat-page-transcript.js";

function MarkdownToggle({
  value,
  onChange,
}: {
  value: "markdown" | "text";
  onChange: (value: "markdown" | "text") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-subtle/60 p-0.5">
      {(["markdown", "text"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            value === mode ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
          onClick={() => onChange(mode)}
        >
          {mode === "markdown" ? "Markdown" : "Text"}
        </button>
      ))}
    </div>
  );
}

function ReasoningToggle({
  value,
  onChange,
}: {
  value: ReasoningDisplayMode;
  onChange: (value: ReasoningDisplayMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-subtle/60 p-0.5">
      {(["hidden", "collapsed", "expanded"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn(
            "rounded px-2 py-1 text-xs font-medium capitalize transition-colors",
            value === mode ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
          onClick={() => onChange(mode)}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

export function ChatConversationPanel({
  activeThreadId,
  transcript,
  renderMode,
  onRenderModeChange,
  reasoningMode,
  onReasoningModeChange,
  loadError,
  sendError,
  deleteDisabled,
  onDelete,
  draft,
  setDraft,
  send,
  sendBusy,
  canSend,
  working,
  approvalsById,
  onResolveApproval,
  resolvingApproval,
  onBack,
}: {
  activeThreadId: string | null;
  transcript: ChatTranscriptItem[];
  renderMode: "markdown" | "text";
  onRenderModeChange: (value: "markdown" | "text") => void;
  reasoningMode: ReasoningDisplayMode;
  onReasoningModeChange: (value: ReasoningDisplayMode) => void;
  loadError: string | null;
  sendError: string | null;
  deleteDisabled: boolean;
  onDelete: () => void;
  draft: string;
  setDraft: (value: string) => void;
  send: () => Promise<void>;
  sendBusy: boolean;
  canSend: boolean;
  working: boolean;
  approvalsById: Record<string, Approval>;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  resolvingApproval: { approvalId: string; state: "approved" | "denied" | "always" } | null;
  onBack?: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wasBottomLockedRef = useRef(true);
  const displayItems = buildTranscriptDisplayItems(transcript, approvalsById);
  const visibleItems =
    reasoningMode === "hidden"
      ? displayItems.filter((item) => item.kind !== "reasoning")
      : displayItems;
  const showInlineWorking =
    working &&
    !displayItems.some((item) => item.kind === "tool" && isActiveToolStatus(item.item.status));

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element) return;
    const handleScroll = () => {
      wasBottomLockedRef.current = isBottomLocked(element);
    };
    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, []);

  useLayoutEffect(() => {
    const element = transcriptRef.current;
    if (!element || !wasBottomLockedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [transcript, working]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="chat-conversation-panel">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 md:hidden"
              data-testid="chat-back"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">
              {activeThreadId ?? "Select a conversation"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ReasoningToggle value={reasoningMode} onChange={onReasoningModeChange} />
          <MarkdownToggle value={renderMode} onChange={onRenderModeChange} />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-fg-muted hover:text-danger-700"
            onClick={onDelete}
            disabled={deleteDisabled}
            data-testid="chat-delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="p-3">
          <Alert variant="error" title="Failed to load conversation" description={loadError} />
        </div>
      ) : null}

      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-y-auto p-2"
        data-testid="chat-transcript"
      >
        {visibleItems.length === 0 ? (
          <div className="text-sm text-fg-muted">No messages yet.</div>
        ) : (
          <div className="grid gap-1.5">
            {visibleItems.map((item) => {
              if (item.kind === "text") {
                return <ChatTextItem key={item.item.id} item={item.item} renderMode={renderMode} />;
              }
              if (item.kind === "reasoning") {
                return (
                  <ChatReasoningItem
                    key={item.item.id}
                    item={item.item}
                    mode={reasoningMode === "hidden" ? "collapsed" : reasoningMode}
                  />
                );
              }
              if (item.kind === "tool") {
                return (
                  <ChatToolItem
                    key={item.item.id}
                    item={item.item}
                    approvalItem={item.approvalItem}
                    approval={item.approval}
                    onResolve={onResolveApproval}
                    resolvingState={
                      item.approvalItem &&
                      resolvingApproval?.approvalId === item.approvalItem.approval_id
                        ? resolvingApproval.state
                        : undefined
                    }
                  />
                );
              }
              return (
                <ChatApprovalItem
                  key={item.item.id}
                  item={item.item}
                  approval={item.approval}
                  onResolve={onResolveApproval}
                  resolvingState={
                    resolvingApproval?.approvalId === item.item.approval_id
                      ? resolvingApproval.state
                      : undefined
                  }
                />
              );
            })}
            {showInlineWorking ? (
              <div className="inline-flex items-center gap-2 px-1 py-0.5 text-xs text-fg-muted">
                <Spinner className="h-4 w-4" />
                Agent is working
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-border p-2">
        {sendError ? (
          <div className="mb-2.5">
            <Alert variant="error" title="Failed to send" description={sendError} />
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Send a message…"
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg outline-none transition-[border-color,box-shadow] duration-150 focus:border-focus-ring"
          />
          <Button
            className="h-[44px] rounded-lg px-4"
            onClick={() => {
              void send();
            }}
            disabled={!canSend}
            isLoading={sendBusy}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
