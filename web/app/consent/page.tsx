"use client";

import React, { useMemo, useRef, useState } from "react";
import type { PolicyDecision } from "./mockPolicy";
import { requestConsentApproval } from "./mockPolicy";

type MessageAuthor = "planner" | "user" | "policy";

interface ChatMessage {
  id: string;
  author: MessageAuthor;
  body: string;
}

const AUTHOR_LABEL: Record<MessageAuthor, string> = {
  planner: "Planner",
  user: "You",
  policy: "Policy Engine",
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "planner-intro",
    author: "planner",
    body: "I can confirm your calendar gaps and vendor preferences. Ready for me to book the flight hold and follow up with loyalty support?",
  },
  {
    id: "planner-scope",
    author: "planner",
    body: "Spend cap: $300. Data shared: departure time, preferred airlines, and loyalty IDs. Escalation trigger: anything over budget or missing authorization.",
  },
];

const STATUS_LABEL: Record<PolicyDecision["status"], string> = {
  approved: "Approved",
  denied: "Denied",
  escalated: "Escalated",
};

function formatPolicyDecision(decision: PolicyDecision) {
  return `Policy decision: ${STATUS_LABEL[decision.status]}. ${decision.reason} Evidence: ${decision.evidence}.`;
}

export default function ConsentReviewPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const messageIdRef = useRef(0);

  const nextMessageId = () => {
    messageIdRef.current += 1;
    return `message-${messageIdRef.current}`;
  };

  const hasUserAction = useMemo(
    () => messages.some((message) => message.author === "user"),
    [messages],
  );

  const handleApprove = async () => {
    if (isProcessing || decision) {
      return;
    }

    setIsProcessing(true);
    setError(null);

    if (!hasUserAction) {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          author: "user",
          body: "Approve this plan and keep an audit trail.",
        },
      ]);
    }

    try {
      const policyDecision = await requestConsentApproval();
      setDecision(policyDecision);
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          author: "policy",
          body: formatPolicyDecision(policyDecision),
        },
      ]);
    } catch (policyError) {
      setDecision(null);
      setError(
        policyError instanceof Error
          ? policyError.message || "Policy decision unavailable. Try again."
          : "Policy decision unavailable. Try again.",
      );
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          author: "policy",
          body: "Policy decision: Failed. Mock policy service is unavailable. Please retry.",
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const auditLabel = decision ? decision.evidence : error ? "Unavailable" : "Pending";
  const statusLabel = decision
    ? STATUS_LABEL[decision.status]
    : error
      ? "Unavailable"
      : "Awaiting response";

  return (
    <main className="consent-container">
      <section className="consent-panel" aria-labelledby="consent-heading">
        <header className="consent-header">
          <h1 id="consent-heading">Consent Review</h1>
          <p>
            Review what the planner will share and approve the guardrails before the
            automation proceeds.
          </p>
        </header>

        <div className="consent-chat" role="log" aria-live="polite" aria-label="Consent conversation">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-bubble chat-${message.author}`}
              aria-label={`${AUTHOR_LABEL[message.author]} message`}
            >
              <span className="chat-author">{AUTHOR_LABEL[message.author]}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>

        <footer className="consent-actions">
          <button
            type="button"
            className="approve-button"
            onClick={handleApprove}
            disabled={isProcessing || Boolean(decision)}
            aria-live="polite"
          >
            {decision ? "Approved" : isProcessing ? "Approving…" : "Approve and continue"}
          </button>

          <dl className="decision-callout" aria-label="Policy response summary">
            <dt>Audit reference</dt>
            <dd>{auditLabel}</dd>
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
          </dl>
          {error ? (
            <p className="decision-error" role="alert">
              {error}
            </p>
          ) : null}
        </footer>
      </section>
    </main>
  );
}
