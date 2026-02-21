import { useState } from "react";
import { Link } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { Notice } from "../components/Notice.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface Approval {
  id: number;
  prompt: string;
  plan_id: string;
  step_index: number;
  status: string;
  created_at: string;
}

export function ApprovalList() {
  const { data, error, loading, refetch } = useApi(
    () => apiFetch<Approval[]>("/approvals"),
    [],
  );
  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const [acting, setActing] = useState(false);

  async function respond(id: number, decision: "approved" | "denied") {
    setActing(true);
    setNotice(null);
    try {
      await apiFetch(`/approvals/${id}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setNotice({ message: `Approval #${id} ${decision}.`, tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setActing(false);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  const approvals = data ?? [];

  return (
    <>
      <PageHeader title="Approvals" subtitle="Review and respond to pending planner requests." />
      {notice && <Notice message={notice.message} tone={notice.tone} />}
      {approvals.length === 0 ? (
        <EmptyState message="No pending approvals." />
      ) : (
        approvals.map((approval) => (
          <Card key={approval.id}>
            <h2>#{approval.id}: {approval.prompt}</h2>
            <p className="muted">
              Plan {approval.plan_id} step {approval.step_index} &middot; {formatDate(approval.created_at)}
            </p>
            <div className="actions">
              <Link to={`/app/approvals/${approval.id}`}>
                <button className="secondary" type="button">Details</button>
              </Link>
              <button type="button" disabled={acting} onClick={() => respond(approval.id, "approved")}>
                Approve
              </button>
              <button className="danger" type="button" disabled={acting} onClick={() => respond(approval.id, "denied")}>
                Deny
              </button>
            </div>
          </Card>
        ))
      )}
    </>
  );
}
