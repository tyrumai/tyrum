import { Link } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";

interface Approval {
  id: number;
  status: string;
}

interface EpisodicEvent {
  event_id: string;
}

interface Watcher {
  id: string;
}

interface DashboardData {
  approvals: Approval[];
  events: EpisodicEvent[];
  watchers: Watcher[];
}

async function fetchDashboard(): Promise<DashboardData> {
  const [approvals, events, watchers] = await Promise.all([
    apiFetch<Approval[]>("/approvals"),
    apiFetch<EpisodicEvent[]>("/memory/events"),
    apiFetch<Watcher[]>("/watchers"),
  ]);
  return { approvals, events, watchers };
}

export function Dashboard() {
  const { data, error, loading } = useApi(fetchDashboard, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return null;

  const pending = data.approvals.filter((a) => a.status === "pending").length;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Operational overview for the local gateway runtime." />
      <div className="grid">
        <Card>
          <h2>Gateway</h2>
          <p><span className="badge">localhost-only</span></p>
        </Card>
        <Card>
          <h2>Pending Approvals</h2>
          <p>{pending}</p>
          <Link to="/app/approvals">View</Link>
        </Card>
        <Card>
          <h2>Recent Activity</h2>
          <p>{data.events.length} events</p>
          <Link to="/app/activity">View</Link>
        </Card>
        <Card>
          <h2>Active Watchers</h2>
          <p>{data.watchers.length}</p>
          <Link to="/app/watchers">View</Link>
        </Card>
      </div>
    </>
  );
}
