import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate, formatJson } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface EpisodicEvent {
  event_id: string;
  event_type: string;
  channel: string;
  occurred_at: string;
  payload: unknown;
}

export function Activity() {
  const { data, error, loading } = useApi(
    () => apiFetch<EpisodicEvent[]>("/memory/events"),
    [],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  const events = data ?? [];

  return (
    <>
      <PageHeader title="Activity" subtitle="Live event stream from gateway memory." />
      {events.length === 0 ? (
        <EmptyState message="No events yet." />
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Channel</th>
                <th>Occurred</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.event_id}>
                  <td>{event.event_id}</td>
                  <td>{event.event_type}</td>
                  <td>{event.channel}</td>
                  <td>{formatDate(event.occurred_at)}</td>
                  <td>
                    <pre><code>{formatJson(event.payload)}</code></pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
