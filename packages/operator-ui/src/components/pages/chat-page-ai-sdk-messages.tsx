import type { Approval } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import type { UIMessage } from "ai";
import type { ResolveApprovalInput } from "@tyrum/operator-core";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReasoningDisplayMode } from "./chat-page-ai-sdk-types.js";
import { MessageCard } from "./chat-page-ai-sdk-message-card.js";

const CHAT_AUTOSCROLL_THRESHOLD_PX = 40;

function isBottomLocked(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTOSCROLL_THRESHOLD_PX
  );
}

export function AiSdkChatMessageList({
  approvalsById,
  core,
  messages,
  onResolveApproval,
  reasoningMode,
  renderMode,
  resolvingApproval,
  working,
}: {
  approvalsById: Record<string, Approval>;
  core: OperatorCore;
  messages: UIMessage[];
  onResolveApproval: (input: ResolveApprovalInput) => void;
  reasoningMode: ReasoningDisplayMode;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  working: boolean;
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wasBottomLockedRef = useRef(true);

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
    if (!element || !wasBottomLockedRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
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
              reasoningMode={reasoningMode}
              renderMode={renderMode}
              resolvingApproval={resolvingApproval}
            />
          ))}
        </div>
      )}
    </div>
  );
}
