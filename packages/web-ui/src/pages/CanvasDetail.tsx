import { Link, useParams } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface CanvasMeta {
  id: string;
  title: string;
  content_type: string;
  created_at: string;
}

export function CanvasDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useApi<CanvasMeta>(
    () => apiFetch<CanvasMeta>(`/canvas/${encodeURIComponent(id!)}/meta`),
    [id],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="notice error">Canvas artifact not found.</p>;

  return (
    <>
      <PageHeader title="Canvas Artifact" />
      <Card>
        <div className="kv">
          <strong>ID</strong><span>{data.id}</span>
          <strong>Title</strong><span>{data.title}</span>
          <strong>Content Type</strong><span>{data.content_type}</span>
          <strong>Created</strong><span>{formatDate(data.created_at)}</span>
        </div>
      </Card>
      <Card>
        <iframe
          title="Canvas"
          src={`/canvas/${encodeURIComponent(data.id)}`}
          style={{ width: "100%", minHeight: "480px", border: "1px solid #dbe3f1", borderRadius: "8px" }}
        />
      </Card>
      <p><Link to="/app/canvas">Back to canvas</Link></p>
    </>
  );
}
