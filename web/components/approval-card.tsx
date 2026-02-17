"use client";

import Link from "next/link";
import type { ApprovalStatus } from "../lib/gateway-client";

export interface ApprovalCardProps {
  id: string;
  prompt: string;
  status: ApprovalStatus;
  createdAt: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  disabled?: boolean;
}

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
};

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export function ApprovalCard({
  id,
  prompt,
  status,
  createdAt,
  onApprove,
  onDeny,
  disabled,
}: ApprovalCardProps) {
  const excerpt =
    prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;

  return (
    <article className="portal-approvals__card">
      <header className="portal-approvals__card-header">
        <Link
          href={`/portal/approvals/${encodeURIComponent(id)}`}
          className="portal-approvals__card-link"
        >
          {excerpt}
        </Link>
        <span
          className={`portal-approvals__badge portal-approvals__badge--${status}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </header>
      <footer className="portal-approvals__card-footer">
        <time
          className="portal-approvals__card-time"
          dateTime={createdAt}
        >
          {formatTimestamp(createdAt)}
        </time>
        {status === "pending" ? (
          <div className="portal-approvals__card-actions">
            <button
              type="button"
              className="portal-approvals__button portal-approvals__button--approve"
              onClick={() => onApprove?.(id)}
              disabled={disabled}
            >
              Approve
            </button>
            <button
              type="button"
              className="portal-approvals__button portal-approvals__button--deny"
              onClick={() => onDeny?.(id)}
              disabled={disabled}
            >
              Deny
            </button>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
