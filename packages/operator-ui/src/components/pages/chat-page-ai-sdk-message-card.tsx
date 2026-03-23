import type { Approval, ResolveApprovalInput, OperatorCore } from "@tyrum/operator-app";
import type { UIMessage } from "ai";
import { Copy } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { useClipboard } from "../../utils/clipboard.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Button } from "../ui/button.js";
import {
  copyToClipboard,
  readCreatedAt,
  textFromMessage,
} from "./chat-page-ai-sdk-message-card-helpers.js";
import { MessageParts } from "./chat-page-ai-sdk-message-card-parts.js";

function messageContainerClassName(role: UIMessage["role"]): string {
  if (role === "assistant") {
    return "border border-border bg-bg";
  }
  if (role === "system") {
    return "border border-warning/30 bg-warning/10";
  }
  return "border border-border bg-bg-subtle/70";
}

export function MessageCard({
  approvalsById,
  core,
  interactiveApprovals = true,
  message,
  onResolveApproval,
  renderMode,
  resolvingApproval,
  toolSchemasById = {},
}: {
  approvalsById: Record<string, Approval>;
  core?: OperatorCore;
  interactiveApprovals?: boolean;
  message: UIMessage;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  toolSchemasById?: Record<string, Record<string, unknown>>;
}) {
  const clipboard = useClipboard();
  const createdAt = readCreatedAt(message);

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

      <MessageParts
        approvalsById={approvalsById}
        core={core}
        interactiveApprovals={interactiveApprovals}
        message={message}
        onResolveApproval={onResolveApproval}
        renderMode={renderMode}
        resolvingApproval={resolvingApproval}
        toolSchemasById={toolSchemasById}
      />
    </div>
  );
}
