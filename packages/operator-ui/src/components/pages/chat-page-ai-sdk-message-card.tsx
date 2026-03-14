import type { Approval } from "@tyrum/client";
import {
  getToolName,
  isDataUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import { Copy, Hammer, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { isRecord } from "../../utils/is-record.js";
import { useClipboard } from "../../utils/clipboard.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { cn } from "../../lib/cn.js";
import { ApprovalActions } from "./approval-actions.js";
import { renderMetaMessagePart } from "./chat-page-ai-sdk-meta-part-card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import type { ReasoningDisplayMode } from "./chat-page-ai-sdk-types.js";

export function readCreatedAt(message: UIMessage): string | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const createdAt =
    typeof metadata?.["created_at"] === "string"
      ? metadata["created_at"]
      : typeof metadata?.["createdAt"] === "string"
        ? metadata["createdAt"]
        : null;
  return createdAt && createdAt.trim().length > 0 ? createdAt : null;
}

function messageContainerClassName(role: UIMessage["role"]): string {
  if (role === "assistant") {
    return "border border-border bg-bg";
  }
  if (role === "system") {
    return "border border-amber-200/70 bg-amber-50/70";
  }
  return "border border-border bg-bg-subtle/70";
}

function stringifyPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function copyToClipboard(clipboard: ReturnType<typeof useClipboard>, value: string): void {
  void clipboard
    .writeText(value)
    .then(() => {
      toast.success("Copied to clipboard");
    })
    .catch(() => {
      toast.error("Failed to copy to clipboard");
    });
}

function formatToolState(state: string): string {
  return state.replace(/-/g, " ");
}

function toolBadgeVariant(state: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (state) {
    case "output-available":
      return "success";
    case "output-error":
    case "output-denied":
      return "danger";
    case "approval-requested":
      return "warning";
    default:
      return "outline";
  }
}

function approvalStatusVariant(
  approval: { approved?: boolean } | undefined,
): React.ComponentProps<typeof Badge>["variant"] {
  if (!approval) {
    return "warning";
  }
  return approval.approved === false ? "danger" : "success";
}

function approvalStateVariant(
  state: ApprovalDataPart["state"],
): React.ComponentProps<typeof Badge>["variant"] {
  if (state === "approved") {
    return "success";
  }
  if (state === "denied" || state === "cancelled" || state === "expired") {
    return "danger";
  }
  return "warning";
}

type ApprovalDataPart = {
  approval_id: string;
  approved?: boolean;
  state: "approved" | "cancelled" | "denied" | "expired" | "pending";
  tool_call_id: string;
  tool_name: string;
};

function readApprovalDataPart(part: UIMessage["parts"][number]): ApprovalDataPart | null {
  if (!isDataUIPart(part) || part.type !== "data-approval-state" || !isRecord(part.data)) {
    return null;
  }

  const approvalId =
    typeof part.data["approval_id"] === "string" ? part.data["approval_id"].trim() : "";
  const toolCallId =
    typeof part.data["tool_call_id"] === "string" ? part.data["tool_call_id"].trim() : "";
  const toolName = typeof part.data["tool_name"] === "string" ? part.data["tool_name"].trim() : "";
  const state = part.data["state"];
  if (
    !approvalId ||
    !toolCallId ||
    !toolName ||
    (state !== "approved" &&
      state !== "cancelled" &&
      state !== "denied" &&
      state !== "expired" &&
      state !== "pending")
  ) {
    return null;
  }

  const approved = typeof part.data["approved"] === "boolean" ? part.data["approved"] : undefined;
  return {
    approval_id: approvalId,
    ...(approved === undefined ? {} : { approved }),
    state,
    tool_call_id: toolCallId,
    tool_name: toolName,
  };
}

function readToolApprovalId(
  part: Extract<UIMessage["parts"][number], { type: string }>,
): string | null {
  if (!isToolUIPart(part)) {
    return null;
  }
  const approval = "approval" in part ? part.approval : undefined;
  return approval?.id?.trim() ? approval.id : null;
}

function textFromMessage(message: UIMessage): string {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      lines.push(part.text);
      continue;
    }
    if (isToolUIPart(part)) {
      lines.push(`${getToolName(part)} (${part.state})`);
      continue;
    }
    if (isDataUIPart(part)) {
      lines.push(`${part.type}: ${stringifyPart(part.data)}`);
      continue;
    }
    if (part.type === "source-url") {
      lines.push(`Source: ${part.title ? `${part.title} ` : ""}${part.url}`.trim());
      continue;
    }
    if (part.type === "source-document") {
      lines.push(
        `Source document: ${part.title} (${part.mediaType})${
          part.filename ? ` [${part.filename}]` : ""
        }`,
      );
      continue;
    }
    if (isFileUIPart(part)) {
      lines.push(
        `File: ${part.filename ? `${part.filename} ` : ""}(${part.mediaType}) ${part.url}`.trim(),
      );
    }
  }
  return lines.join("\n\n");
}

function TextBlock({ value, renderMode }: { value: string; renderMode: "markdown" | "text" }) {
  if (renderMode === "markdown") {
    return (
      <div className="prose prose-sm min-w-0 max-w-none break-words text-fg [overflow-wrap:anywhere] prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-fg prose-p:my-2 prose-p:break-words prose-p:text-fg prose-ul:my-2 prose-ol:my-2 prose-strong:text-fg prose-code:break-words prose-code:text-fg prose-code:[overflow-wrap:anywhere] prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:bg-bg-subtle prose-pre:[overflow-wrap:anywhere]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-[13px] leading-5 text-fg [overflow-wrap:anywhere]">
      {value}
    </pre>
  );
}

function ToolPartCard({
  approval,
  onResolveApproval,
  part,
  resolvingApproval,
  showApprovalDetails,
}: {
  approval: Approval | null;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  part: Extract<UIMessage["parts"][number], { type: string }>;
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  showApprovalDetails: boolean;
}) {
  if (!isToolUIPart(part)) {
    return null;
  }
  const approvalId = readToolApprovalId(part);
  const isPendingApproval = part.state === "approval-requested" && approvalId;
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-2 py-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Hammer className="h-4 w-4 shrink-0" />
            <span className="truncate">{getToolName(part)}</span>
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            call <code className="font-mono">{part.toolCallId}</code>
          </div>
        </div>
        <Badge variant={toolBadgeVariant(part.state)}>{formatToolState(part.state)}</Badge>
      </div>

      {"input" in part && part.input !== undefined ? (
        <div className="mt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Input</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg px-2 py-1.5 text-xs text-fg [overflow-wrap:anywhere]">
            {stringifyPart(part.input)}
          </pre>
        </div>
      ) : null}

      {"output" in part && part.output !== undefined ? (
        <div className="mt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Output</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg px-2 py-1.5 text-xs text-fg [overflow-wrap:anywhere]">
            {stringifyPart(part.output)}
          </pre>
        </div>
      ) : null}

      {"errorText" in part && typeof part.errorText === "string" ? (
        <div className="mt-2 break-words text-sm text-danger-700 [overflow-wrap:anywhere]">
          {part.errorText}
        </div>
      ) : null}

      {showApprovalDetails && "approval" in part && part.approval ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Approval {part.approval.id}</span>
          <Badge variant={approvalStatusVariant(part.approval)}>
            {part.approval.approved === false
              ? "denied"
              : part.approval.approved === true
                ? "approved"
                : "pending"}
          </Badge>
        </div>
      ) : null}

      {showApprovalDetails && isPendingApproval && approvalId ? (
        <div className="mt-2 rounded-md border border-warning-300/70 bg-warning-50/70 px-2 py-1.5">
          <div className="text-xs text-warning-900">
            User approval is required before this tool can continue.
          </div>
          <ApprovalActions
            approvalId={approvalId}
            approval={approval}
            resolvingState={
              resolvingApproval?.approvalId === approvalId ? resolvingApproval.state : undefined
            }
            onResolve={onResolveApproval}
            className="mt-2"
          />
        </div>
      ) : null}
    </div>
  );
}

function ApprovalDataPartCard({
  approval,
  onResolveApproval,
  part,
  resolvingApproval,
}: {
  approval: Approval | null;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  part: ApprovalDataPart;
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
}) {
  const pending = part.state === "pending";
  return (
    <div className="rounded-lg border border-warning-300/70 bg-warning-50/70 px-2 py-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-warning-950">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">Approval {part.approval_id}</span>
          </div>
          <div className="mt-1 text-xs text-warning-900/80">
            {part.tool_name} <code className="font-mono">{part.tool_call_id}</code>
          </div>
        </div>
        <Badge variant={approvalStateVariant(part.state)}>{part.state}</Badge>
      </div>

      {pending ? (
        <div className="mt-2">
          <div className="text-xs text-warning-900">
            User approval is required before this tool can continue.
          </div>
          <ApprovalActions
            approvalId={part.approval_id}
            approval={approval}
            resolvingState={
              resolvingApproval?.approvalId === part.approval_id
                ? resolvingApproval.state
                : undefined
            }
            onResolve={onResolveApproval}
            className="mt-2"
          />
        </div>
      ) : null}
    </div>
  );
}

export function MessageCard({
  approvalsById,
  message,
  onResolveApproval,
  reasoningMode,
  renderMode,
  resolvingApproval,
}: {
  approvalsById: Record<string, Approval>;
  message: UIMessage;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  reasoningMode: ReasoningDisplayMode;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
}) {
  const clipboard = useClipboard();
  const createdAt = readCreatedAt(message);
  const approvalIdsWithDataPart = new Set(
    message.parts
      .map((part) => readApprovalDataPart(part)?.approval_id ?? null)
      .filter((approvalId): approvalId is string => approvalId !== null),
  );

  return (
    <div
      className={cn(
        "group relative w-full min-w-0 rounded-lg px-2 py-1.5",
        messageContainerClassName(message.role),
      )}
    >
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fg-muted">
          <span>{message.role}</span>
          {createdAt ? (
            <>
              <span>•</span>
              <span>{formatRelativeTime(createdAt)}</span>
            </>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
          onClick={() => {
            copyToClipboard(clipboard, textFromMessage(message));
          }}
          title="Copy message"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2">
        {message.parts.map((part: UIMessage["parts"][number], index: number) => {
          if (isTextUIPart(part)) {
            return (
              <TextBlock
                key={`${message.id}:text:${index}`}
                value={part.text}
                renderMode={renderMode}
              />
            );
          }
          if (isReasoningUIPart(part)) {
            if (reasoningMode === "hidden") {
              return null;
            }
            return (
              <details
                key={`${message.id}:reasoning:${index}`}
                className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5"
                open={reasoningMode === "expanded"}
              >
                <summary className="cursor-pointer text-xs uppercase tracking-wide text-fg-muted">
                  Reasoning
                </summary>
                <div className="mt-2">
                  <TextBlock value={part.text} renderMode="text" />
                </div>
              </details>
            );
          }
          if (isToolUIPart(part)) {
            const approvalId = readToolApprovalId(part);
            const approval = approvalId ? (approvalsById[approvalId] ?? null) : null;
            return (
              <ToolPartCard
                key={`${message.id}:tool:${index}`}
                approval={approval}
                onResolveApproval={onResolveApproval}
                part={part}
                resolvingApproval={resolvingApproval}
                showApprovalDetails={!approvalId || !approvalIdsWithDataPart.has(approvalId)}
              />
            );
          }
          if (isDataUIPart(part)) {
            const approvalPart = readApprovalDataPart(part);
            if (approvalPart) {
              return (
                <ApprovalDataPartCard
                  key={`${message.id}:approval:${index}`}
                  approval={approvalsById[approvalPart.approval_id] ?? null}
                  onResolveApproval={onResolveApproval}
                  part={approvalPart}
                  resolvingApproval={resolvingApproval}
                />
              );
            }
            return (
              <div
                key={`${message.id}:data:${index}`}
                className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5"
              >
                <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">
                  {part.type}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-fg [overflow-wrap:anywhere]">
                  {stringifyPart(part.data)}
                </pre>
              </div>
            );
          }
          if (part.type === "step-start") {
            return null;
          }
          const metaPart = renderMetaMessagePart({ index, messageId: message.id, part });
          if (metaPart) {
            return metaPart;
          }
          return (
            <div
              key={`${message.id}:part:${index}`}
              className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5 text-xs text-fg-muted"
            >
              Unsupported part <code>{part.type}</code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
