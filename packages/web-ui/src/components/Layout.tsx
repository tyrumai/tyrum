import { NavLink, Outlet } from "react-router";

const NAV_LINKS = [
  ["/app", "Dashboard"],
  ["/app/approvals", "Approvals"],
  ["/app/activity", "Activity"],
  ["/app/playbooks", "Playbooks"],
  ["/app/watchers", "Watchers"],
  ["/app/canvas", "Canvas"],
  ["/app/settings", "Settings"],
  ["/app/linking", "Linking"],
  ["/app/onboarding/start", "Onboarding"],
] as const;

export function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Tyrum</div>
        <p className="brand-sub">Single-user, self-hosted runtime control plane.</p>
        <nav className="nav" aria-label="Primary">
          {NAV_LINKS.map(([href, label]) => (
            <NavLink
              key={href}
              to={href}
              end={href === "/app"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
