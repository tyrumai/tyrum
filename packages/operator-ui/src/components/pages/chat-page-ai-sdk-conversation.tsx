import type { Approval } from "@tyrum/client";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import type { OperatorCore } from "@tyrum/operator-core";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ChevronLeft, Send, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import type {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  TyrumAiSdkChatSession,
} from "@tyrum/client";
import { AiSdkChatMessageList } from "./chat-page-ai-sdk-messages.js";
import { getSessionDisplayTitle } from "./chat-page-ai-sdk-shared.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";

const DRAFT_MIN_ROWS = 2;
const DRAFT_MAX_ROWS = 12;
const DEFAULT_DRAFT_LINE_HEIGHT_PX = 20;

function parsePixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function syncDraftHeight(textarea: HTMLTextAreaElement): void {
  const styles = window.getComputedStyle(textarea);
  const lineHeight = parsePixelValue(styles.lineHeight);
  const fontSize = parsePixelValue(styles.fontSize);
  const resolvedLineHeight =
    lineHeight > 0 ? lineHeight : fontSize > 0 ? fontSize * 1.5 : DEFAULT_DRAFT_LINE_HEIGHT_PX;
  const paddingHeight = parsePixelValue(styles.paddingTop) + parsePixelValue(styles.paddingBottom);
  const borderHeight =
    parsePixelValue(styles.borderTopWidth) + parsePixelValue(styles.borderBottomWidth);
  const minHeight = resolvedLineHeight * DRAFT_MIN_ROWS + paddingHeight + borderHeight;
  const maxHeight = resolvedLineHeight * DRAFT_MAX_ROWS + paddingHeight + borderHeight;

  textarea.style.height = "auto";
  const scrollHeight = textarea.scrollHeight + borderHeight;
  const nextHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
}

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

export function AiSdkConversation({
  approvalsById,
  core,
  onBack,
  onDelete,
  onResolveApproval,
  onRenderModeChange,
  onSessionMessages,
  renderMode,
  resolvingApproval,
  resolveAttachedNodeId,
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
  onSessionMessages: (messages: UIMessage[]) => void;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  resolveAttachedNodeId: () => Promise<string | null>;
  session: TyrumAiSdkChatSession;
  sessionClient: ReturnType<typeof createTyrumAiSdkChatSessionClient>;
  transport: ReturnType<typeof createTyrumAiSdkChatTransport>;
}) {
  const [draft, setDraft] = useState("");
  const [followRequestId, setFollowRequestId] = useState(0);
  const [sendErrorDismissed, setSendErrorDismissed] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
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
        core.chatStore.hydrateActiveSession(reloaded);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chat.setMessages, chat.status, core.chatStore, session.session_id, sessionClient]);

  useLayoutEffect(() => {
    const textarea = draftRef.current;
    if (!textarea) {
      return;
    }
    syncDraftHeight(textarea);
  }, [draft]);

  useEffect(() => {
    setSendErrorDismissed(false);
  }, [chat.error]);

  useEffect(() => {
    draftRef.current?.focus();
  }, []);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const attachedNodeId = await resolveAttachedNodeId();
    setDraft("");
    setFollowRequestId((value) => value + 1);
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
            <div className="truncate text-sm font-medium text-fg">
              {getSessionDisplayTitle(session.title)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
        followRequestId={followRequestId}
        messages={chat.messages}
        onResolveApproval={onResolveApproval}
        renderMode={renderMode}
        resolvingApproval={resolvingApproval}
        working={working}
      />

      {chat.error && !sendErrorDismissed ? (
        <div className="px-3 pb-2">
          <Alert
            variant="error"
            title="Failed to send message"
            description={chat.error.message}
            onDismiss={() => setSendErrorDismissed(true)}
          />
        </div>
      ) : null}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={draftRef}
            rows={DRAFT_MIN_ROWS}
            className="box-border flex-1 resize-none overflow-y-hidden rounded-md border border-border bg-bg px-3 py-2 text-sm leading-5 text-fg outline-none"
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
