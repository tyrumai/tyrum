import { useParams } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate, formatJson } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface TimelineEvent {
  step_index: number;
  occurred_at: string;
  action: unknown;
  redactions: string[];
}

interface PlanTimeline {
  plan_id: string;
  generated_at: string;
  event_count: number;
  has_redactions: boolean;
  events: TimelineEvent[];
}

export function PlanTimeline() {
  const { planId } = useParams<{ planId: string }>();
  const { data, error, loading } = useApi(
    () => apiFetch<PlanTimeline>(`/api/audit/plan/${planId}`),
    [planId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="notice error">No timeline found.</p>;

  const timeline = data;

  return (
    <>
      <PageHeader title="Plan Timeline" />
      <Card>
        <div className="kv">
          <strong>Plan ID</strong><span>{timeline.plan_id}</span>
          <strong>Generated</strong><span>{formatDate(timeline.generated_at)}</span>
          <strong>Events</strong><span>{timeline.event_count}</span>
          <strong>Redactions</strong><span>{timeline.has_redactions ? "yes" : "no"}</span>
        </div>
      </Card>
      <Card>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Occurred</th>
              <th>Action</th>
              <th>Redactions</th>
            </tr>
          </thead>
          <tbody>
            {timeline.events.map((event, i) => (
              <tr key={i}>
                <td>{event.step_index}</td>
                <td>{formatDate(event.occurred_at)}</td>
                <td>
                  <pre><code>{formatJson(event.action)}</code></pre>
                </td>
                <td>{event.redactions.join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
