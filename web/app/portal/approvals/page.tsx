"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "../../../components/approval-card";
import {
  getGatewayClient,
  type Approval,
  type ApprovalStatus,
} from "../../../lib/gateway-client";

const POLL_INTERVAL_MS = 30_000;

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
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

  const loadApprovals = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const data = await client.getApprovals();
      if (isMountedRef.current) {
        setApprovals(data);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load approvals.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadApprovals();
    const interval = window.setInterval(loadApprovals, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadApprovals]);

  const handleRespond = async (
    id: string,
    decision: "approved" | "denied",
  ) => {
    if (pendingId) {
      return;
    }
    setPendingId(id);
    setError(null);
    setSuccessMessage(null);

    try {
      const client = getGatewayClient();
      const result = await client.respondToApproval(id, decision);
      if (isMountedRef.current) {
        setApprovals((current) =>
          current.map((a) =>
            a.id === id
              ? { ...a, status: result.status as ApprovalStatus }
              : a,
          ),
        );
        setSuccessMessage(
          `Approval ${id} ${decision === "approved" ? "approved" : "denied"}.`,
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
        setPendingId(null);
      }
    }
  };

  return (
    <main className="portal-approvals" aria-labelledby="approvals-heading">
      <header className="portal-approvals__header">
        <div>
          <p className="portal-approvals__eyebrow">Portal</p>
          <h1 id="approvals-heading">Approval Queue</h1>
        </div>
        <p className="portal-approvals__lead">
          Review and respond to pending approval requests from the planner.
        </p>
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

      <section
        aria-label="Approval list"
        className="portal-approvals__list"
      >
        {isLoading && approvals.length === 0 ? (
          <p className="portal-approvals__placeholder" role="status">
            Loading approvals...
          </p>
        ) : null}
        {!isLoading && approvals.length === 0 && !error ? (
          <p className="portal-approvals__placeholder" role="status">
            No approvals yet.
          </p>
        ) : null}
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            id={approval.id}
            prompt={approval.prompt}
            status={approval.status}
            createdAt={approval.created_at}
            onApprove={(aId) => handleRespond(aId, "approved")}
            onDeny={(aId) => handleRespond(aId, "denied")}
            disabled={pendingId === approval.id}
          />
        ))}
      </section>
    </main>
  );
}
