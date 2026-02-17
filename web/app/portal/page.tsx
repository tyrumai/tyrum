export default function PortalDashboard() {
  return (
    <main className="portal-dashboard" aria-labelledby="dashboard-heading">
      <header className="portal-dashboard__header">
        <h1 id="dashboard-heading">Dashboard</h1>
      </header>
      <div className="portal-dashboard__grid">
        <StatusCard title="Gateway" value="checking..." />
        <StatusCard title="Pending Approvals" value="0" />
        <StatusCard title="Recent Activity" value="---" />
      </div>
    </main>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="portal-dashboard__card">
      <h3 className="portal-dashboard__card-title">{title}</h3>
      <p className="portal-dashboard__card-value">{value}</p>
    </article>
  );
}
