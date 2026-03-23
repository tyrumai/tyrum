import type {
  Approval,
  OperatorCore,
  ResolveApprovalInput,
  TyrumAiSdkChatSession,
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
} from "@tyrum/operator-app";
import { QueueMode, type QueueMode as QueueModeT } from "@tyrum/contracts";
import { useChat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import { ChevronLeft, Paperclip, Send, Square, Trash2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { AiSdkChatMessageList } from "./chat-page-ai-sdk-messages.js";
import { getSessionDisplayTitle } from "./chat-page-ai-sdk-shared.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Select } from "../ui/select.js";

const DRAFT_MIN_ROWS = 2;
const DRAFT_MAX_ROWS = 12;
const DEFAULT_DRAFT_LINE_HEIGHT_PX = 20;
const CHAT_QUEUE_MODE_OPTIONS: ReadonlyArray<{ label: string; value: QueueModeT }> = [
  { value: "steer", label: "Steer" },
  { value: "steer_backlog", label: "Steer + backlog" },
  { value: "followup", label: "Follow-up" },
  { value: "collect", label: "Collect" },
  { value: "interrupt", label: "Interrupt" },
];

type ChatSessionWithQueueMode = TyrumAiSdkChatSession & {
  queue_mode?: QueueModeT;
};

function readSessionQueueMode(session: ChatSessionWithQueueMode): QueueModeT {
  const parsed = QueueMode.safeParse(session.queue_mode);
  return parsed.success ? parsed.data : "steer";
}

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

function fileToUiPart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url) {
        reject(new Error(`Failed to read file ${file.name}`));
        return;
      }
      resolve({
        type: "file",
        mediaType: file.type || "application/octet-stream",
        ...(file.name ? { filename: file.name } : {}),
        url,
      });
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(`Failed to read file ${file.name}`));
    });
    reader.readAsDataURL(file);
  });
}

async function filesToUiParts(files: File[]): Promise<FileUIPart[]> {
  return await Promise.all(files.map((file) => fileToUiPart(file)));
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
  toolSchemasById,
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
  session: ChatSessionWithQueueMode;
  sessionClient: ReturnType<typeof createTyrumAiSdkChatSessionClient>;
  toolSchemasById: Record<string, Record<string, unknown>>;
  transport: ReturnType<typeof createTyrumAiSdkChatTransport>;
}) {
  const [draft, setDraft] = useState("");
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [followRequestId, setFollowRequestId] = useState(0);
  const [queueMode, setQueueMode] = useState<QueueModeT>(() => readSessionQueueMode(session));
  const [queueModeBusy, setQueueModeBusy] = useState(false);
  const [sendErrorDismissed, setSendErrorDismissed] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const draftFilesRef = useRef<HTMLInputElement | null>(null);
  const previousStatusRef = useRef<ReturnType<typeof useChat<UIMessage>>["status"]>("ready");
  const currentSessionIdRef = useRef(session.session_id);
  const queueModeRequestRef = useRef<symbol | null>(null);
  const queueModeId = useId();
  currentSessionIdRef.current = session.session_id;
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

  useEffect(() => {
    setQueueMode(readSessionQueueMode(session));
    setQueueModeBusy(false);
  }, [session.queue_mode, session.session_id]);

  const clearDraftFiles = (): void => {
    setDraftFiles([]);
    if (draftFilesRef.current) {
      draftFilesRef.current.value = "";
    }
  };

  const send = async (): Promise<void> => {
    if (chat.status === "submitted" || chat.status === "streaming") {
      return;
    }
    const text = draft.trim();
    if (!text && draftFiles.length === 0) {
      return;
    }
    const attachedNodeId = await resolveAttachedNodeId();
    const files = draftFiles.length > 0 ? await filesToUiParts(draftFiles) : undefined;
    setDraft("");
    clearDraftFiles();
    setFollowRequestId((value) => value + 1);
    await chat.sendMessage(
      text
        ? {
            ...(files ? { files } : {}),
            text,
          }
        : files
          ? { files }
          : undefined,
      attachedNodeId ? { body: { attached_node_id: attachedNodeId } } : undefined,
    );
  };

  const working = chat.status === "submitted" || chat.status === "streaming";
  const canSend = (draft.trim().length > 0 || draftFiles.length > 0) && !working;

  const isCurrentQueueModeRequest = (requestKey: symbol, requestSessionId: string): boolean =>
    queueModeRequestRef.current === requestKey && currentSessionIdRef.current === requestSessionId;

  const handleQueueModeChange = async (nextQueueMode: QueueModeT): Promise<void> => {
    if (queueModeBusy || nextQueueMode === queueMode) {
      return;
    }

    const previousQueueMode = queueMode;
    const requestSessionId = session.session_id;
    const requestKey = Symbol("queue-mode-request");
    queueModeRequestRef.current = requestKey;
    setQueueMode(nextQueueMode);
    setQueueModeBusy(true);

    try {
      const result = await sessionClient.setQueueMode({
        session_id: requestSessionId,
        queue_mode: nextQueueMode,
      });
      if (!isCurrentQueueModeRequest(requestKey, requestSessionId)) {
        return;
      }
      setQueueMode(result.queue_mode);
      const reloaded = await sessionClient.get({ session_id: requestSessionId });
      if (!isCurrentQueueModeRequest(requestKey, requestSessionId)) {
        return;
      }
      const active = core.chatStore.getSnapshot().active;
      const activeSessionId = active.sessionId ?? active.session?.session_id ?? null;
      if (activeSessionId !== requestSessionId) {
        return;
      }
      core.chatStore.hydrateActiveSession(reloaded);
    } catch (error) {
      if (!isCurrentQueueModeRequest(requestKey, requestSessionId)) {
        return;
      }
      setQueueMode(previousQueueMode);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (isCurrentQueueModeRequest(requestKey, requestSessionId)) {
        queueModeRequestRef.current = null;
        setQueueModeBusy(false);
      }
    }
  };

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
        toolSchemasById={toolSchemasById}
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-subtle/40 px-2 py-1">
            <label htmlFor={queueModeId} className="text-xs font-medium text-fg-muted">
              Queue
            </label>
            <Select
              id={queueModeId}
              bare
              className="h-8 min-w-[10rem] border-0 bg-transparent px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
              data-testid="ai-sdk-chat-queue-mode"
              disabled={queueModeBusy}
              value={queueMode}
              onChange={(event) => {
                const parsed = QueueMode.safeParse(event.currentTarget.value);
                if (!parsed.success) {
                  return;
                }
                void handleQueueModeChange(parsed.data);
              }}
            >
              {CHAT_QUEUE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-8 gap-2"
            data-testid="ai-sdk-chat-attach"
            disabled={chat.status === "submitted"}
            onClick={() => {
              draftFilesRef.current?.click();
            }}
          >
            <Paperclip className="h-4 w-4" />
            Attach files
          </Button>
          {draftFiles.length > 0 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-border bg-bg-subtle/40 px-2 py-1 text-xs text-fg-muted">
              <span className="font-medium text-fg">Attachments</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {draftFiles.map((file) => (
                  <span
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-fg"
                  >
                    {file.name || "Unnamed file"}
                  </span>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-6 px-2 text-xs text-fg-muted hover:text-fg"
                data-testid="ai-sdk-chat-clear-attachments"
                onClick={clearDraftFiles}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          ) : null}
          <input
            ref={draftFilesRef}
            className="hidden"
            data-testid="ai-sdk-chat-files"
            multiple
            type="file"
            onChange={(event) => {
              setDraftFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={draftRef}
            rows={DRAFT_MIN_ROWS}
            aria-label="Send a message"
            className="box-border flex-1 resize-none overflow-y-hidden rounded-md border border-border bg-bg px-3 py-2 text-sm leading-5 text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
            data-testid="ai-sdk-chat-draft"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={handleDraftKeyDown}
            placeholder="Send a message"
            value={draft}
          />
          <Button
            aria-label={working ? "Stop response" : "Send message"}
            className="h-10 w-10 shrink-0 px-0"
            data-testid="ai-sdk-chat-send"
            disabled={working ? false : !canSend}
            title={working ? "Stop response" : "Send message"}
            variant={working ? "danger" : "primary"}
            onClick={() => {
              if (working) {
                void chat.stop();
                return;
              }
              void send();
            }}
          >
            {working ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
