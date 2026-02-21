import { Link } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface ContextResponse {
  memory: {
    facts: number;
    episodic_events: number;
    capability_memories: number;
  };
  sessions: { total: number };
}

interface ContextReport {
  report_id: string;
  run_id: string;
  created_at: string;
}

interface ContextListResponse {
  reports: ContextReport[];
}

interface ContextData {
  context: ContextResponse;
  list: ContextListResponse;
}

async function fetchContextData(): Promise<ContextData> {
  const [context, list] = await Promise.all([
    apiFetch<ContextResponse>("/context"),
    apiFetch<ContextListResponse>("/context/list"),
  ]);
  return { context, list };
}

export function Context() {
  const { data, error, loading } = useApi(fetchContextData, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return null;

  const { context, list } = data;
  const reports = list.reports ?? [];

  return (
    <>
      <PageHeader title="Context" subtitle="Memory state and context reports." />
      <div className="grid">
        <Card>
          <h2>Facts</h2>
          <p>{context.memory.facts}</p>
        </Card>
        <Card>
          <h2>Episodic Events</h2>
          <p>{context.memory.episodic_events}</p>
        </Card>
        <Card>
          <h2>Capability Memories</h2>
          <p>{context.memory.capability_memories}</p>
        </Card>
        <Card>
          <h2>Sessions</h2>
          <p>{context.sessions.total}</p>
        </Card>
      </div>

      {reports.length === 0 ? (
        <EmptyState message="No context reports yet." />
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Run ID</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.report_id}>
                  <td>{report.report_id}</td>
                  <td><Link to={`/app/context/${report.run_id}`}>{report.run_id}</Link></td>
                  <td>{formatDate(report.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
