import type { Approval, OperatorCore, ResolveApprovalInput } from "@tyrum/operator-app";
import type { UIMessage } from "ai";
import { useEffect, useLayoutEffect, useRef } from "react";
import { MessageCard } from "./chat-page-ai-sdk-message-card.js";

const CHAT_AUTOSCROLL_THRESHOLD_PX = 40;

function isBottomLocked(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTOSCROLL_THRESHOLD_PX
  );
}

function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

export function AiSdkChatMessageList({
  approvalsById,
  core,
  followRequestId,
  messages,
  onResolveApproval,
  renderMode,
  resolvingApproval,
  toolSchemasById,
  working,
}: {
  approvalsById: Record<string, Approval>;
  core: OperatorCore;
  followRequestId: number;
  messages: UIMessage[];
  onResolveApproval: (input: ResolveApprovalInput) => void;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  toolSchemasById: Record<string, Record<string, unknown>>;
  working: boolean;
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wasBottomLockedRef = useRef(true);
  const lastFollowRequestIdRef = useRef(followRequestId);

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element) {
      return;
    }
    const handleScroll = () => {
      wasBottomLockedRef.current = isBottomLocked(element);
    };
    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const element = transcriptRef.current;
    if (!element || followRequestId === lastFollowRequestIdRef.current) {
      return;
    }
    lastFollowRequestIdRef.current = followRequestId;
    wasBottomLockedRef.current = true;
    scrollToBottom(element);
  }, [followRequestId]);

  useLayoutEffect(() => {
    const element = transcriptRef.current;
    if (!element || !wasBottomLockedRef.current) {
      return;
    }
    scrollToBottom(element);
  }, [messages, working]);

  return (
    <div
      ref={transcriptRef}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2"
      data-testid="ai-sdk-chat-transcript"
    >
      {messages.length === 0 ? (
        <div className="text-sm text-fg-muted">No messages yet.</div>
      ) : (
        <div className="grid min-w-0 gap-1.5">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              approvalsById={approvalsById}
              core={core}
              message={message}
              onResolveApproval={onResolveApproval}
              renderMode={renderMode}
              resolvingApproval={resolvingApproval}
              toolSchemasById={toolSchemasById}
            />
          ))}
        </div>
      )}
    </div>
  );
}
