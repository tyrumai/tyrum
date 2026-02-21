import { Link, useParams } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate, formatJson } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface ContextDetailResponse {
  report_id: string;
  run_id: string;
  created_at: string;
  report: unknown;
}

export function ContextDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, loading } = useApi(
    () => apiFetch<ContextDetailResponse>(`/context/detail/${runId}`),
    [runId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="notice error">Context report not found.</p>;

  return (
    <>
      <PageHeader title="Context Report" />
      <Card>
        <div className="kv">
          <strong>Report ID</strong><span>{data.report_id}</span>
          <strong>Run ID</strong><span>{data.run_id}</span>
          <strong>Created</strong><span>{formatDate(data.created_at)}</span>
        </div>
      </Card>
      <Card>
        <h2>Report</h2>
        <pre><code>{formatJson(data.report)}</code></pre>
      </Card>
      <p><Link to="/app/context">Back to context</Link></p>
    </>
  );
}
