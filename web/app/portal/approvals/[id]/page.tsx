"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getGatewayClient,
  type Approval,
  type ApprovalStatus,
} from "../../../../lib/gateway-client";

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
};

export default function ApprovalDetailPage() {
  const params = useParams<{ id: string }>();
  const approvalId = params.id;

  const [approval, setApproval] = useState<Approval | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!successMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const loadApproval = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const data = await client.getApproval(approvalId);
      if (isMountedRef.current) {
        setApproval(data);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load approval.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [approvalId]);

  useEffect(() => {
    loadApproval();
  }, [loadApproval]);

  const handleRespond = async (decision: "approved" | "denied") => {
    if (responding) {
      return;
    }
    setResponding(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const client = getGatewayClient();
      const result = await client.respondToApproval(approvalId, decision);
      if (isMountedRef.current) {
        setApproval((current) =>
          current
            ? {
                ...current,
                status: result.status as ApprovalStatus,
                responded_at: result.responded_at,
              }
            : current,
        );
        setSuccessMessage(
          decision === "approved"
            ? "Approval granted."
            : "Approval denied.",
        );
      }
    } catch (respondError) {
      if (isMountedRef.current) {
        const message =
          respondError instanceof Error && respondError.message
            ? respondError.message
            : "Unable to submit response.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setResponding(false);
      }
    }
  };

  return (
    <main className="portal-approvals" aria-labelledby="approval-detail-heading">
      <header className="portal-approvals__header">
        <div>
          <p className="portal-approvals__eyebrow">Portal</p>
          <h1 id="approval-detail-heading">Approval Detail</h1>
        </div>
        <Link href="/portal/approvals" className="portal-approvals__back-link">
          Back to queue
        </Link>
      </header>

      {error ? (
        <p
          className="portal-approvals__message portal-approvals__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {!error && successMessage ? (
        <p
          className="portal-approvals__message portal-approvals__message--success"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      {isLoading ? (
        <p className="portal-approvals__placeholder" role="status">
          Loading approval...
        </p>
      ) : null}

      {!isLoading && approval ? (
        <section
          aria-label="Approval details"
          className="portal-approvals__detail"
        >
          <div className="portal-approvals__detail-meta">
            <dl className="portal-approvals__detail-fields">
              <div>
                <dt>Status</dt>
                <dd>
                  <span
                    className={`portal-approvals__badge portal-approvals__badge--${approval.status}`}
                  >
                    {STATUS_LABELS[approval.status]}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Plan ID</dt>
                <dd>{approval.plan_id}</dd>
              </div>
              <div>
                <dt>Step</dt>
                <dd>{approval.step_index}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  <time dateTime={approval.created_at}>
                    {new Date(approval.created_at).toLocaleString()}
                  </time>
                </dd>
              </div>
              {approval.responded_at ? (
                <div>
                  <dt>Responded</dt>
                  <dd>
                    <time dateTime={approval.responded_at}>
                      {new Date(approval.responded_at).toLocaleString()}
                    </time>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <article className="portal-approvals__detail-section">
            <h2>Prompt</h2>
            <p className="portal-approvals__detail-prompt">
              {approval.prompt}
            </p>
          </article>

          <article className="portal-approvals__detail-section">
            <h2>Context</h2>
            <pre className="portal-approvals__detail-context">
              <code>{JSON.stringify(approval.context, null, 2)}</code>
            </pre>
          </article>

          {approval.status === "pending" ? (
            <div className="portal-approvals__detail-actions">
              <button
                type="button"
                className="portal-approvals__button portal-approvals__button--approve"
                onClick={() => handleRespond("approved")}
                disabled={responding}
              >
                {responding ? "Submitting..." : "Approve"}
              </button>
              <button
                type="button"
                className="portal-approvals__button portal-approvals__button--deny"
                onClick={() => handleRespond("denied")}
                disabled={responding}
              >
                {responding ? "Submitting..." : "Deny"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
