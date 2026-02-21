import { useState } from "react";
import { useParams, Link } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate, formatJson } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { Notice } from "../components/Notice.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface Approval {
  id: number;
  prompt: string;
  plan_id: string;
  step_index: number;
  status: string;
  created_at: string;
  responded_at: string | null;
  context: unknown;
}

export function ApprovalDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi(
    () => apiFetch<Approval>(`/approvals/${id}`),
    [id],
  );
  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const [acting, setActing] = useState(false);

  async function respond(decision: "approved" | "denied") {
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
  if (!data) return <p className="notice error">Approval not found</p>;

  const approval = data;

  return (
    <>
      <PageHeader title={`Approval #${approval.id}`} />
      {notice && <Notice message={notice.message} tone={notice.tone} />}
      <Card>
        <div className="kv">
          <strong>Status</strong><span>{approval.status}</span>
          <strong>Plan</strong><span>{approval.plan_id}</span>
          <strong>Step</strong><span>{approval.step_index}</span>
          <strong>Created</strong><span>{formatDate(approval.created_at)}</span>
          <strong>Responded</strong><span>{formatDate(approval.responded_at)}</span>
        </div>
        <h2>Prompt</h2>
        <p>{approval.prompt}</p>
        <h2>Context</h2>
        <pre><code>{formatJson(approval.context)}</code></pre>
        {approval.status === "pending" && (
          <div className="actions">
            <button type="button" disabled={acting} onClick={() => respond("approved")}>
              Approve
            </button>
            <button className="danger" type="button" disabled={acting} onClick={() => respond("denied")}>
              Deny
            </button>
          </div>
        )}
      </Card>
      <p><Link to="/app/approvals">Back to approvals</Link></p>
    </>
  );
}
