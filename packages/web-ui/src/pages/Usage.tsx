import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface UsageResponse {
  runs: { total: number; completed: number; failed: number };
  steps: { total: number };
  attempts: { total: number };
  cost: { total_input_tokens: number; total_output_tokens: number; total_usd_micros: number };
}

interface StatusResponse {
  version: string;
  uptime_ms: number;
  role: string;
  db_type: string;
  connected_clients: number;
  capability_counts: Record<string, number>;
  queue_depth: number;
  feature_flags: string[];
}

interface UsageData {
  usage: UsageResponse;
  status: StatusResponse;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatCost(usdMicros: number): string {
  return `$${(usdMicros / 1_000_000).toFixed(4)}`;
}

async function fetchUsageData(): Promise<UsageData> {
  const [usage, status] = await Promise.all([
    apiFetch<UsageResponse>("/usage"),
    apiFetch<StatusResponse>("/status"),
  ]);
  return { usage, status };
}

export function Usage() {
  const { data, error, loading } = useApi(fetchUsageData, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return null;

  const { usage, status } = data;

  return (
    <>
      <PageHeader title="Usage & Status" subtitle="Runtime metrics and system information." />
      <div className="grid">
        <Card>
          <h2>Runs</h2>
          <p>{usage.runs.total} total</p>
          <p>{usage.runs.completed} completed / {usage.runs.failed} failed</p>
        </Card>
        <Card>
          <h2>Steps</h2>
          <p>{usage.steps.total}</p>
        </Card>
        <Card>
          <h2>Attempts</h2>
          <p>{usage.attempts.total}</p>
        </Card>
        <Card>
          <h2>Cost</h2>
          <p>{formatCost(usage.cost.total_usd_micros)}</p>
          <p>{usage.cost.total_input_tokens.toLocaleString()} in / {usage.cost.total_output_tokens.toLocaleString()} out</p>
        </Card>
      </div>

      <Card>
        <h2>System Status</h2>
        <div className="kv">
          <strong>Version</strong><span><span className="badge">{status.version}</span></span>
          <strong>Uptime</strong><span>{formatUptime(status.uptime_ms)}</span>
          <strong>Role</strong><span>{status.role}</span>
          <strong>Database</strong><span>{status.db_type}</span>
          <strong>Connected Clients</strong><span>{status.connected_clients}</span>
          <strong>Queue Depth</strong><span>{status.queue_depth}</span>
        </div>
      </Card>

      <Card>
        <h2>Feature Flags</h2>
        <p>
          {status.feature_flags.map((flag) => (
            <span key={flag} className="badge">{flag}</span>
          ))}
          {status.feature_flags.length === 0 && <span className="muted">None</span>}
        </p>
      </Card>
    </>
  );
}
