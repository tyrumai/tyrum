import type {
  Approval,
  SessionTranscriptApprovalItem,
  SessionTranscriptItem,
  SessionTranscriptTextItem,
  SessionTranscriptToolItem,
} from "@tyrum/client";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import { ChevronLeft, Copy, Hammer, Send, ShieldCheck, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { ApprovalActions } from "./approval-actions.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { ChatThreadsPanel, type ChatThreadSummary } from "./chat-page-threads.js";

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

function transcriptTimestamp(item: SessionTranscriptItem): string {
  return item.kind === "text" ? item.created_at : item.updated_at;
}

function formatToolStatus(status: SessionTranscriptToolItem["status"]): string {
  return status === "awaiting_approval" ? "awaiting approval" : status;
}

function toolBadgeVariant(
  status: SessionTranscriptToolItem["status"],
): React.ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "awaiting_approval":
      return "warning";
    default:
      return "outline";
  }
}

function approvalBadgeVariant(
  status: SessionTranscriptApprovalItem["status"],
): React.ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "approved":
      return "success";
    case "denied":
    case "expired":
    case "cancelled":
      return "danger";
    default:
      return "warning";
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy to clipboard");
  }
}

export { ChatThreadsPanel, type ChatThreadSummary };

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

function ChatTextItem({
  item,
  renderMode,
}: {
  item: SessionTranscriptTextItem;
  renderMode: "markdown" | "text";
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border px-4 py-3 shadow-sm",
        item.role === "assistant"
          ? "border-border bg-bg"
          : item.role === "system"
            ? "border-amber-200/70 bg-amber-50/70"
            : "border-border bg-bg-subtle/70",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
          <span>{item.role}</span>
          <span>•</span>
          <span>{formatRelativeTime(item.created_at)}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
          onClick={() => {
            void copyToClipboard(item.content);
          }}
          title="Copy message"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      {renderMode === "markdown" ? (
        <div className="prose prose-sm max-w-none text-fg prose-headings:text-fg prose-p:text-fg prose-strong:text-fg prose-code:text-fg prose-pre:bg-bg-subtle">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words text-sm text-fg">{item.content}</pre>
      )}
    </div>
  );
}

function ChatToolItem({ item }: { item: SessionTranscriptToolItem }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle/50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Hammer className="h-4 w-4" />
          <span>{item.tool_id}</span>
        </div>
        <Badge variant={toolBadgeVariant(item.status)}>{formatToolStatus(item.status)}</Badge>
      </div>
      <div className="text-sm text-fg-muted">{item.summary || "Working…"}</div>
      {item.error ? <div className="mt-2 text-sm text-danger-700">{item.error}</div> : null}
      <div className="mt-2 text-xs text-fg-muted">
        {formatRelativeTime(transcriptTimestamp(item))}
        {typeof item.duration_ms === "number" ? ` • ${item.duration_ms} ms` : ""}
      </div>
    </div>
  );
}

function ChatApprovalItem({
  item,
  approval,
  onResolve,
  resolvingState,
}: {
  item: SessionTranscriptApprovalItem;
  approval?: Approval | null;
  onResolve: (input: ResolveApprovalInput) => void;
  resolvingState?: "approved" | "denied" | "always";
}) {
  const actionable = item.status === "pending";
  return (
    <div className="rounded-xl border border-warning-300 bg-warning-50/80 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-warning-900">
          <ShieldCheck className="h-4 w-4" />
          <span>{item.title}</span>
        </div>
        <Badge variant={approvalBadgeVariant(item.status)}>{item.status}</Badge>
      </div>
      <div className="text-sm text-warning-950">{item.detail}</div>
      {actionable ? (
        <ApprovalActions
          approvalId={item.approval_id}
          approval={approval}
          resolvingState={resolvingState}
          onResolve={onResolve}
          className="mt-3 flex flex-wrap gap-2"
        />
      ) : null}
      <div className="mt-2 text-xs text-warning-900/80">{formatRelativeTime(item.updated_at)}</div>
    </div>
  );
}

export function ChatConversationPanel({
  activeThreadId,
  transcript,
  renderMode,
  onRenderModeChange,
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
  transcript: SessionTranscriptItem[];
  renderMode: "markdown" | "text";
  onRenderModeChange: (value: "markdown" | "text") => void;
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
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
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
        <div className="p-4">
          <Alert variant="error" title="Failed to load conversation" description={loadError} />
        </div>
      ) : null}

      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="chat-transcript"
      >
        {transcript.length === 0 ? (
          <div className="text-sm text-fg-muted">No messages yet.</div>
        ) : (
          <div className="grid gap-3">
            {transcript.map((item) => {
              if (item.kind === "text") {
                return <ChatTextItem key={item.id} item={item} renderMode={renderMode} />;
              }
              if (item.kind === "tool") {
                return <ChatToolItem key={item.id} item={item} />;
              }
              return (
                <ChatApprovalItem
                  key={item.id}
                  item={item}
                  approval={approvalsById[item.approval_id] ?? null}
                  onResolve={onResolveApproval}
                  resolvingState={
                    resolvingApproval?.approvalId === item.approval_id
                      ? resolvingApproval.state
                      : undefined
                  }
                />
              );
            })}
            {working ? (
              <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-subtle/40 px-4 py-3 text-sm text-fg-muted">
                <Spinner className="h-4 w-4" />
                Agent is working
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        {sendError ? (
          <div className="mb-3">
            <Alert variant="error" title="Failed to send" description={sendError} />
          </div>
        ) : null}
        <div className="flex items-end gap-3">
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
            className="min-h-[52px] flex-1 resize-none rounded-xl border border-border bg-bg px-4 py-3 text-sm text-fg outline-none transition focus:border-focus-ring"
          />
          <Button
            className="h-[52px] rounded-xl px-4"
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
