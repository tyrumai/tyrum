import type {
  Approval,
  SessionTranscriptApprovalItem,
  SessionTranscriptItem,
  SessionTranscriptTextItem,
  SessionTranscriptToolItem,
} from "@tyrum/client";
import { isApprovalHumanActionableStatus, type ResolveApprovalInput } from "@tyrum/operator-core";
import { Copy, Hammer, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useClipboard } from "../../utils/clipboard.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { ApprovalActions } from "./approval-actions.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export type ReasoningDisplayMode = "hidden" | "collapsed" | "expanded";

type ChatReasoningItem = {
  kind: "reasoning";
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ChatTranscriptItem = SessionTranscriptItem | ChatReasoningItem;

export type ChatDisplayItem =
  | { kind: "text"; item: SessionTranscriptTextItem }
  | { kind: "reasoning"; item: ChatReasoningItem }
  | {
      kind: "tool";
      item: SessionTranscriptToolItem;
      approvalItem: SessionTranscriptApprovalItem | null;
      approval: Approval | null;
    }
  | {
      kind: "approval";
      item: SessionTranscriptApprovalItem;
      approval: Approval | null;
    };

function transcriptTimestamp(item: ChatTranscriptItem): string {
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

export function formatApprovalStatus(status: SessionTranscriptApprovalItem["status"]): string {
  switch (status) {
    case "queued":
      return "Guardian queued";
    case "reviewing":
      return "Guardian reviewing";
    case "awaiting_human":
      return "Awaiting human review";
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
  }
}

export function isActiveToolStatus(status: SessionTranscriptToolItem["status"]): boolean {
  return status === "queued" || status === "running" || status === "awaiting_approval";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readApprovalToolCallId(
  item: SessionTranscriptApprovalItem,
  approval: Approval | null | undefined,
): string | null {
  if (typeof item.tool_call_id === "string" && item.tool_call_id.trim().length > 0) {
    return item.tool_call_id;
  }
  const context = isRecord(approval?.context) ? approval.context : null;
  const toolCallId = typeof context?.["tool_call_id"] === "string" ? context["tool_call_id"] : "";
  return toolCallId.trim().length > 0 ? toolCallId : null;
}

function approvalResolutionNote(
  item: SessionTranscriptApprovalItem,
  approval: Approval | null,
): string | null {
  const review = approval?.latest_review;
  const reason = typeof review?.reason === "string" ? review.reason.trim() : "";
  if (reason) return reason;
  const prompt = typeof approval?.prompt === "string" ? approval.prompt.trim() : "";
  const detail = item.detail.trim();
  if (!detail || detail === prompt) return null;
  return detail;
}

export function buildTranscriptDisplayItems(
  transcript: ChatTranscriptItem[],
  approvalsById: Record<string, Approval>,
): ChatDisplayItem[] {
  const toolCallIds = new Set<string>();
  for (const item of transcript) {
    if (item.kind === "tool") {
      toolCallIds.add(item.tool_call_id);
    }
  }

  const linkedApprovals = new Map<
    string,
    { item: SessionTranscriptApprovalItem; approval: Approval | null }
  >();
  for (const item of transcript) {
    if (item.kind !== "approval") continue;
    const approval = approvalsById[item.approval_id] ?? null;
    const toolCallId = readApprovalToolCallId(item, approval);
    if (!toolCallId || !toolCallIds.has(toolCallId)) continue;
    const existing = linkedApprovals.get(toolCallId);
    if (!existing || item.updated_at >= existing.item.updated_at) {
      linkedApprovals.set(toolCallId, { item, approval });
    }
  }

  const displayItems: ChatDisplayItem[] = [];
  for (const item of transcript) {
    if (item.kind === "text") {
      displayItems.push({ kind: "text", item });
      continue;
    }
    if (item.kind === "reasoning") {
      displayItems.push({ kind: "reasoning", item });
      continue;
    }
    if (item.kind === "tool") {
      const linkedApproval = linkedApprovals.get(item.tool_call_id);
      displayItems.push({
        kind: "tool",
        item,
        approvalItem: linkedApproval?.item ?? null,
        approval: linkedApproval?.approval ?? null,
      });
      continue;
    }

    const approval = approvalsById[item.approval_id] ?? null;
    const toolCallId = readApprovalToolCallId(item, approval);
    if (toolCallId && toolCallIds.has(toolCallId)) continue;
    displayItems.push({ kind: "approval", item, approval });
  }

  return displayItems;
}

export function ChatTextItem({
  item,
  renderMode,
}: {
  item: SessionTranscriptTextItem;
  renderMode: "markdown" | "text";
}) {
  const clipboard = useClipboard();

  return (
    <div
      className={
        item.role === "assistant"
          ? "group relative rounded-lg border border-border bg-bg px-2 py-1.5"
          : item.role === "system"
            ? "group relative rounded-lg border border-amber-200/70 bg-amber-50/70 px-2 py-1.5"
            : "group relative rounded-lg border border-border bg-bg-subtle/70 px-2 py-1.5"
      }
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fg-muted">
          <span>{item.role}</span>
          <span>•</span>
          <span>{formatRelativeTime(item.created_at)}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
          onClick={() => {
            void clipboard
              .writeText(item.content)
              .then(() => {
                toast.success("Copied to clipboard");
              })
              .catch(() => {
                toast.error("Failed to copy to clipboard");
              });
          }}
          title="Copy message"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      {renderMode === "markdown" ? (
        <div className="prose prose-sm max-w-none text-fg prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-fg prose-p:my-2 prose-p:text-fg prose-ul:my-2 prose-ol:my-2 prose-strong:text-fg prose-code:text-fg prose-pre:my-2 prose-pre:bg-bg-subtle">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words text-[13px] leading-5 text-fg">
          {item.content}
        </pre>
      )}
    </div>
  );
}

export function ChatToolItem({
  item,
  approvalItem,
  approval,
  onResolve,
  resolvingState,
}: {
  item: SessionTranscriptToolItem;
  approvalItem: SessionTranscriptApprovalItem | null;
  approval: Approval | null;
  onResolve: (input: ResolveApprovalInput) => void;
  resolvingState?: "approved" | "denied" | "always";
}) {
  const approvalStatus = approval?.status ?? approvalItem?.status ?? "awaiting_human";
  const approvalNote = approvalItem ? approvalResolutionNote(approvalItem, approval) : null;
  const actionable = isApprovalHumanActionableStatus(approvalStatus);

  return (
    <div
      className="rounded-lg border border-border bg-bg-subtle/40 px-2 py-1.5"
      data-testid={`chat-tool-card-${item.tool_call_id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Hammer className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.tool_id}</span>
          </div>
          <div className="mt-1 text-sm text-fg-muted">{item.summary || "Working…"}</div>
          {item.error ? <div className="mt-1.5 text-sm text-danger-700">{item.error}</div> : null}
        </div>
        <Badge variant={toolBadgeVariant(item.status)}>{formatToolStatus(item.status)}</Badge>
      </div>
      {approvalItem && actionable ? (
        <div
          className="mt-2 rounded-md border border-warning-300/70 bg-warning-50/70 px-2 py-1.5"
          data-testid={`chat-tool-approval-${approvalItem.approval_id}`}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-warning-900">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{approvalItem.title}</span>
            </div>
            <Badge variant={approvalBadgeVariant(approvalStatus)}>
              {formatApprovalStatus(approvalStatus)}
            </Badge>
          </div>
          <div className="text-sm text-warning-950">{approvalItem.detail}</div>
          <ApprovalActions
            approvalId={approvalItem.approval_id}
            approval={approval}
            resolvingState={resolvingState}
            onResolve={onResolve}
            className="mt-2 flex flex-wrap gap-2"
          />
        </div>
      ) : approvalItem ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted"
          data-testid={`chat-tool-approval-note-${approvalItem.approval_id}`}
        >
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-fg-muted" />
            <span>Approval</span>
          </div>
          <Badge variant={approvalBadgeVariant(approvalStatus)}>
            {formatApprovalStatus(approvalStatus)}
          </Badge>
          {approvalNote ? <span className="truncate">{approvalNote}</span> : null}
        </div>
      ) : null}
      <div className="mt-2 text-[11px] text-fg-muted">
        {formatRelativeTime(transcriptTimestamp(item))}
        {typeof item.duration_ms === "number" ? ` • ${item.duration_ms} ms` : ""}
      </div>
    </div>
  );
}

export function ChatReasoningItem({
  item,
  mode,
}: {
  item: ChatReasoningItem;
  mode: Exclude<ReasoningDisplayMode, "hidden">;
}) {
  const [open, setOpen] = useState(mode === "expanded");

  useEffect(() => {
    setOpen(mode === "expanded");
  }, [mode]);

  return (
    <details
      className="rounded-lg border border-border/70 bg-bg-subtle/30 px-2 py-1.5"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-fg-muted">
        Model reasoning
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-fg-muted">
        {item.content}
      </pre>
      <div className="mt-2 text-[11px] text-fg-muted">{formatRelativeTime(item.updated_at)}</div>
    </details>
  );
}

export function ChatApprovalItem({
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
  const approvalStatus = approval?.status ?? item.status;
  const actionable = isApprovalHumanActionableStatus(approvalStatus);

  return (
    <div
      className="rounded-lg border border-warning-300 bg-warning-50/80 px-2 py-1.5"
      data-testid={`chat-approval-card-${item.approval_id}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-warning-900">
          <ShieldCheck className="h-4 w-4" />
          <span>{item.title}</span>
        </div>
        <Badge variant={approvalBadgeVariant(approvalStatus)}>
          {formatApprovalStatus(approvalStatus)}
        </Badge>
      </div>
      <div className="text-sm text-warning-950">{item.detail}</div>
      {actionable ? (
        <ApprovalActions
          approvalId={item.approval_id}
          approval={approval}
          resolvingState={resolvingState}
          onResolve={onResolve}
          className="mt-2 flex flex-wrap gap-2"
        />
      ) : null}
      <div className="mt-2 text-[11px] text-warning-900/80">
        {formatRelativeTime(item.updated_at)}
      </div>
    </div>
  );
}
