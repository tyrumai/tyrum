import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface PresenceEntry {
  client_id: string;
  role: string;
  node_id: string;
  agent_id: string;
  capabilities: string[];
  connected_at: string;
  last_seen_at: string;
  metadata: unknown;
}

interface PresenceResponse {
  entries: PresenceEntry[];
  count: number;
}

export function Presence() {
  const { data, error, loading } = useApi(
    () => apiFetch<PresenceResponse>("/presence"),
    [],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  const entries = data?.entries ?? [];

  return (
    <>
      <PageHeader title="Presence" subtitle={`${data?.count ?? 0} connected instances`} />
      {entries.length === 0 ? (
        <EmptyState message="No connected instances." />
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th>Client ID</th>
                <th>Role</th>
                <th>Node ID</th>
                <th>Agent ID</th>
                <th>Capabilities</th>
                <th>Connected</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.client_id}>
                  <td>{entry.client_id}</td>
                  <td>{entry.role}</td>
                  <td>{entry.node_id}</td>
                  <td>{entry.agent_id}</td>
                  <td>
                    {entry.capabilities.map((cap) => (
                      <span key={cap} className="badge">{cap}</span>
                    ))}
                  </td>
                  <td>{formatDate(entry.connected_at)}</td>
                  <td>{formatDate(entry.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
