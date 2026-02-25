import { shell } from "../html.js";
import type { WebUiDeps } from "../types.js";

export async function renderDashboardPage(
  deps: WebUiDeps,
  search: URLSearchParams,
): Promise<string> {
  const [approvals, episodicEvents, watcherRows] = await Promise.all([
    deps.approvalDal.getByStatus("pending"),
    deps.memoryDal.getEpisodicEvents(20),
    deps.watcherProcessor.listWatchers(),
  ]);
  const pending = approvals.length;
  const events = episodicEvents.length;
  const watchers = watcherRows.length;

  const body = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <p>Operational overview for the local gateway runtime.</p>
      </div>
      <div class="grid">
        <article class="card"><h2>Gateway</h2><p><span class="badge">${deps.isLocalOnly ? "localhost-only" : "exposed"}</span></p></article>
        <article class="card"><h2>Pending Approvals</h2><p>${String(pending)}</p></article>
        <article class="card"><h2>Recent Activity</h2><p>${String(events)} events</p></article>
        <article class="card"><h2>Active Watchers</h2><p>${String(watchers)}</p></article>
      </div>
    `;
  return shell("Dashboard", "/app", search, body);
}
