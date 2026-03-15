import type { Approval } from "@tyrum/client";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import type { OperatorCore } from "@tyrum/operator-core";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ChevronLeft, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import type {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  TyrumAiSdkChatSession,
} from "@tyrum/client";
import { AiSdkChatMessageList } from "./chat-page-ai-sdk-messages.js";
import type { ReasoningDisplayMode } from "./chat-page-ai-sdk-types.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";

function MarkdownToggle({
  onChange,
  value,
}: {
  onChange: (value: "markdown" | "text") => void;
  value: "markdown" | "text";
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-subtle/60 p-0.5">
      {(["markdown", "text"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={
            value === mode
              ? "rounded px-2 py-1 text-xs font-medium bg-bg text-fg shadow-sm"
              : "rounded px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg"
          }
          onClick={() => {
            onChange(mode);
          }}
        >
          {mode === "markdown" ? "Markdown" : "Text"}
        </button>
      ))}
    </div>
  );
}

function ReasoningToggle({
  onChange,
  value,
}: {
  onChange: (value: ReasoningDisplayMode) => void;
  value: ReasoningDisplayMode;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-subtle/60 p-0.5">
      {(["hidden", "collapsed", "expanded"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={
            value === mode
              ? "rounded px-2 py-1 text-xs font-medium capitalize bg-bg text-fg shadow-sm"
              : "rounded px-2 py-1 text-xs font-medium capitalize text-fg-muted hover:text-fg"
          }
          onClick={() => {
            onChange(mode);
          }}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

export function AiSdkConversation({
  approvalsById,
  core,
  onBack,
  onDelete,
  onResolveApproval,
  onRenderModeChange,
  onReasoningModeChange,
  onSessionMessages,
  renderMode,
  resolvingApproval,
  resolveAttachedNodeId,
  reasoningMode,
  session,
  sessionClient,
  transport,
}: {
  approvalsById: Record<string, Approval>;
  core: OperatorCore;
  onBack?: () => void;
  onDelete: () => void;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  onRenderModeChange: (value: "markdown" | "text") => void;
  onReasoningModeChange: (value: ReasoningDisplayMode) => void;
  onSessionMessages: (messages: UIMessage[]) => void;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  resolveAttachedNodeId: () => Promise<string | null>;
  reasoningMode: ReasoningDisplayMode;
  session: TyrumAiSdkChatSession;
  sessionClient: ReturnType<typeof createTyrumAiSdkChatSessionClient>;
  transport: ReturnType<typeof createTyrumAiSdkChatTransport>;
}) {
  const [draft, setDraft] = useState("");
  const previousStatusRef = useRef<ReturnType<typeof useChat<UIMessage>>["status"]>("ready");
  const chat = useChat<UIMessage>({
    id: session.session_id,
    messages: session.messages,
    onError: (error: Error) => {
      toast.error(error.message);
    },
    transport,
  });

  useEffect(() => {
    onSessionMessages(chat.messages);
  }, [chat.messages, onSessionMessages]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = chat.status;
    if (
      chat.status !== "ready" ||
      (previousStatus !== "streaming" && previousStatus !== "submitted")
    ) {
      return;
    }

    let cancelled = false;
    void sessionClient
      .get({ session_id: session.session_id })
      .then((reloaded) => {
        if (cancelled) {
          return;
        }
        chat.setMessages(reloaded.messages);
        onSessionMessages(reloaded.messages);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chat.setMessages, chat.status, onSessionMessages, session.session_id, sessionClient]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const attachedNodeId = await resolveAttachedNodeId();
    setDraft("");
    await chat.sendMessage(
      {
        text,
      },
      attachedNodeId ? { body: { attached_node_id: attachedNodeId } } : undefined,
    );
  };

  const working = chat.status === "submitted" || chat.status === "streaming";
  const canSend = draft.trim().length > 0 && chat.status !== "submitted";

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (!canSend) {
      return;
    }
    void send();
  };

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="chat-conversation-panel"
    >
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
            <div className="truncate text-sm font-medium text-fg">{session.thread_id}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ReasoningToggle value={reasoningMode} onChange={onReasoningModeChange} />
          <MarkdownToggle value={renderMode} onChange={onRenderModeChange} />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-fg-muted hover:text-danger-700"
            data-testid="chat-delete"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AiSdkChatMessageList
        approvalsById={approvalsById}
        core={core}
        messages={chat.messages}
        onResolveApproval={onResolveApproval}
        reasoningMode={reasoningMode}
        renderMode={renderMode}
        resolvingApproval={resolvingApproval}
        working={working}
      />

      {chat.error ? (
        <div className="px-3 pb-2">
          <Alert variant="error" title="Failed to send message" description={chat.error.message} />
        </div>
      ) : null}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[88px] flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none"
            data-testid="ai-sdk-chat-draft"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={handleDraftKeyDown}
            placeholder="Send a message"
            value={draft}
          />
          <Button
            className="h-10"
            data-testid="ai-sdk-chat-send"
            disabled={!canSend}
            isLoading={chat.status === "submitted"}
            onClick={() => {
              void send();
            }}
          >
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
