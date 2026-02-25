import { esc, extractThreadMessageText, fmtDate, shell } from "../html.js";
import type { WebUiDeps } from "../types.js";

export type SessionPageResult = {
  html: string;
  status?: 500;
};

export async function renderSessionPage(
  deps: WebUiDeps,
  search: URLSearchParams,
): Promise<SessionPageResult> {
  const db = deps.db;

  const key = (search.get("key") ?? "").trim();
  const laneInputs = search
    .getAll("lanes")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const allowedLanes = new Set(["main", "subagent", "cron", "heartbeat"]);
  const selectedLanes = Array.from(new Set(laneInputs.filter((lane) => allowedLanes.has(lane))));
  const lanes = selectedLanes.length > 0 ? selectedLanes : ["main"];

  const laneCheckboxes = ["main", "subagent", "cron", "heartbeat"]
    .map((lane) => {
      const checked = lanes.includes(lane) ? "checked" : "";
      return `<label><input type="checkbox" name="lanes" value="${lane}" ${checked}/> ${lane}</label>`;
    })
    .join("\n");

  const filterForm = `
      <form method="get" action="/app/session">
        <article class="card">
          <label for="sessionKey">Session key</label>
          <input id="sessionKey" name="key" placeholder="agent:<agentId>:<channel>:<account>:<container>:<id>" value="${esc(key)}" />
          <h2>Lane filters</h2>
          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));">
            ${laneCheckboxes}
          </div>
          <div class="actions"><button type="submit">Load timeline</button></div>
        </article>
      </form>
    `;

  if (!db) {
    const body = `
        <div class="page-header">
          <h1>Session Timeline</h1>
          <p class="muted">DB access is required to render session timelines.</p>
        </div>
        ${filterForm}
        <div class="card"><p class="notice error">Gateway DB handle not available in web UI deps.</p></div>
      `;
    return { html: shell("Session", "/app/session", search, body), status: 500 };
  }

  if (!key) {
    const body = `
        <div class="page-header">
          <h1>Session Timeline</h1>
          <p>Unified timeline merged from durable state (chat, execution, approvals, artifacts).</p>
        </div>
        ${filterForm}
      `;
    return { html: shell("Session", "/app/session", search, body) };
  }

  const lanePlaceholders = lanes.map(() => "?").join(", ");
  const laneSql = `(${lanePlaceholders})`;
  const laneParams = lanes.slice();

  const queryErrors: string[] = [];
  const safeAll = async <T>(label: string, fn: () => Promise<T[]>) => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queryErrors.push(`${label}: ${message}`);
      return [];
    }
  };

  const [queueOverrides, queueRows, inboxRows, runs, steps, attempts, approvals, artifacts] =
    await Promise.all([
      safeAll("lane_queue_mode_overrides", () =>
        db.all<{ lane: string; queue_mode: string; updated_at_ms: number }>(
          `SELECT lane, queue_mode, updated_at_ms
             FROM lane_queue_mode_overrides
             WHERE key = ? AND lane IN ${laneSql}
             ORDER BY updated_at_ms DESC`,
          [key, ...laneParams],
        ),
      ),
      safeAll("channel_inbox.pending", () =>
        db.all<{
          inbox_id: number;
          lane: string;
          status: string;
          received_at_ms: number;
          message_id: string;
          queue_mode: string;
          payload_json: string;
        }>(
          `SELECT inbox_id, lane, status, received_at_ms, message_id, queue_mode, payload_json
             FROM channel_inbox
             WHERE key = ?
               AND lane IN ${laneSql}
               AND status IN ('queued', 'processing')
             ORDER BY received_at_ms ASC, inbox_id ASC
             LIMIT 200`,
          [key, ...laneParams],
        ),
      ),
      safeAll("channel_inbox.recent", () =>
        db.all<{
          inbox_id: number;
          lane: string;
          status: string;
          received_at_ms: number;
          processed_at: string | null;
          reply_text: string | null;
          message_id: string;
          payload_json: string;
        }>(
          `SELECT inbox_id, lane, status, received_at_ms, processed_at, reply_text, message_id, payload_json
             FROM channel_inbox
             WHERE key = ?
               AND lane IN ${laneSql}
             ORDER BY received_at_ms DESC, inbox_id DESC
             LIMIT 200`,
          [key, ...laneParams],
        ),
      ),
      safeAll("execution_runs", () =>
        db.all<{
          run_id: string;
          lane: string;
          status: string;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
        }>(
          `SELECT run_id, lane, status, created_at, started_at, finished_at
             FROM execution_runs
             WHERE key = ?
               AND lane IN ${laneSql}
             ORDER BY created_at DESC, run_id DESC
             LIMIT 200`,
          [key, ...laneParams],
        ),
      ),
      safeAll("execution_steps", () =>
        db.all<{
          step_id: string;
          run_id: string;
          lane: string;
          step_index: number;
          status: string;
          created_at: string;
        }>(
          `SELECT s.step_id, s.run_id, r.lane AS lane, s.step_index, s.status, s.created_at
             FROM execution_steps s
             JOIN execution_runs r ON r.run_id = s.run_id
             WHERE r.key = ?
               AND r.lane IN ${laneSql}
             ORDER BY s.created_at DESC, s.step_id DESC
             LIMIT 400`,
          [key, ...laneParams],
        ),
      ),
      safeAll("execution_attempts", () =>
        db.all<{
          attempt_id: string;
          step_id: string;
          lane: string;
          attempt: number;
          status: string;
          started_at: string;
          finished_at: string | null;
        }>(
          `SELECT a.attempt_id, a.step_id, r.lane AS lane, a.attempt, a.status, a.started_at, a.finished_at
             FROM execution_attempts a
             JOIN execution_steps s ON s.step_id = a.step_id
             JOIN execution_runs r ON r.run_id = s.run_id
             WHERE r.key = ?
               AND r.lane IN ${laneSql}
             ORDER BY a.started_at DESC, a.attempt_id DESC
             LIMIT 600`,
          [key, ...laneParams],
        ),
      ),
      safeAll("approvals", () =>
        db.all<{
          id: number;
          lane: string | null;
          status: string;
          created_at: string;
          prompt: string;
          run_id: string | null;
        }>(
          `SELECT id, lane, status, created_at, prompt, run_id
             FROM approvals
             WHERE key = ?
               AND COALESCE(lane, 'main') IN ${laneSql}
             ORDER BY created_at DESC, id DESC
             LIMIT 200`,
          [key, ...laneParams],
        ),
      ),
      safeAll("execution_artifacts", () =>
        db.all<{
          artifact_id: string;
          kind: string;
          uri: string;
          created_at: string;
          run_id: string | null;
          step_id: string | null;
          attempt_id: string | null;
          lane: string;
        }>(
          `SELECT a.artifact_id, a.kind, a.uri, a.created_at, a.run_id, a.step_id, a.attempt_id, r.lane AS lane
             FROM execution_artifacts a
             JOIN execution_runs r ON r.run_id = a.run_id
             WHERE r.key = ?
               AND r.lane IN ${laneSql}
             ORDER BY a.created_at DESC, a.artifact_id DESC
             LIMIT 200`,
          [key, ...laneParams],
        ),
      ),
    ]);

  type TimelineItem = {
    ts: number;
    occurred_at: string;
    lane: string;
    kind: string;
    detail: string;
  };

  const items: TimelineItem[] = [];

  for (const row of inboxRows) {
    const messageText = extractThreadMessageText(row.payload_json) || row.message_id;
    const occurredAt = new Date(row.received_at_ms).toISOString();
    items.push({
      ts: row.received_at_ms,
      occurred_at: occurredAt,
      lane: row.lane,
      kind: "message.in",
      detail: `${row.status} ${row.message_id}: ${messageText}`,
    });

    if (row.reply_text) {
      const replyTs = (() => {
        const parsed = row.processed_at ? Date.parse(row.processed_at) : NaN;
        return Number.isFinite(parsed) ? parsed : row.received_at_ms;
      })();
      items.push({
        ts: replyTs,
        occurred_at: row.processed_at ?? occurredAt,
        lane: row.lane,
        kind: "message.out",
        detail: row.reply_text,
      });
    }
  }

  for (const run of runs) {
    const ts = Date.parse(run.created_at);
    items.push({
      ts: Number.isFinite(ts) ? ts : 0,
      occurred_at: run.created_at,
      lane: run.lane,
      kind: "run",
      detail: `${run.run_id} status=${run.status}`,
    });
  }

  for (const step of steps) {
    const ts = Date.parse(step.created_at);
    items.push({
      ts: Number.isFinite(ts) ? ts : 0,
      occurred_at: step.created_at,
      lane: step.lane,
      kind: "step",
      detail: `${step.step_id} run=${step.run_id} index=${String(step.step_index)} status=${step.status}`,
    });
  }

  for (const attempt of attempts) {
    const ts = Date.parse(attempt.started_at);
    items.push({
      ts: Number.isFinite(ts) ? ts : 0,
      occurred_at: attempt.started_at,
      lane: attempt.lane,
      kind: "attempt",
      detail: `${attempt.attempt_id} step=${attempt.step_id} attempt=${String(attempt.attempt)} status=${attempt.status}`,
    });
  }

  for (const approval of approvals) {
    const ts = Date.parse(approval.created_at);
    items.push({
      ts: Number.isFinite(ts) ? ts : 0,
      occurred_at: approval.created_at,
      lane: approval.lane ?? "main",
      kind: "approval",
      detail: `#${String(approval.id)} status=${approval.status} run=${approval.run_id ?? ""} ${approval.prompt}`,
    });
  }

  for (const artifact of artifacts) {
    const ts = Date.parse(artifact.created_at);
    items.push({
      ts: Number.isFinite(ts) ? ts : 0,
      occurred_at: artifact.created_at,
      lane: artifact.lane,
      kind: "artifact",
      detail: `${artifact.artifact_id} kind=${artifact.kind} uri=${artifact.uri}`,
    });
  }

  items.sort((a, b) => b.ts - a.ts);

  const overridesByLane = new Map<string, string>();
  for (const override of queueOverrides) {
    if (!overridesByLane.has(override.lane)) {
      overridesByLane.set(override.lane, override.queue_mode);
    }
  }

  const queueSummaryRows = lanes
    .map((lane) => {
      const mode = overridesByLane.get(lane) ?? "default";
      const queued = queueRows.filter((row) => row.lane === lane && row.status === "queued").length;
      const processing = queueRows.filter(
        (row) => row.lane === lane && row.status === "processing",
      ).length;
      return `<tr>
          <td>${esc(lane)}</td>
          <td>${esc(mode)}</td>
          <td>${String(queued)}</td>
          <td>${String(processing)}</td>
        </tr>`;
    })
    .join("");

  const queueRowsHtml = queueRows
    .map((row) => {
      const msg = extractThreadMessageText(row.payload_json) || row.message_id;
      return `<tr>
          <td>${esc(row.lane)}</td>
          <td>${esc(row.status)}</td>
          <td>${esc(row.queue_mode)}</td>
          <td>${fmtDate(new Date(row.received_at_ms).toISOString())}</td>
          <td><code>${esc(row.message_id)}</code></td>
          <td>${esc(msg)}</td>
        </tr>`;
    })
    .join("");

  const timelineRows = items
    .slice(0, 400)
    .map(
      (item) => `<tr>
          <td>${fmtDate(item.occurred_at)}</td>
          <td>${esc(item.lane)}</td>
          <td>${esc(item.kind)}</td>
          <td><pre><code>${esc(item.detail)}</code></pre></td>
        </tr>`,
    )
    .join("");

  const queryErrorsHtml =
    queryErrors.length > 0
      ? `<article class="card">
            <p class="notice error">DB query errors</p>
            <ul>${queryErrors.map((value) => `<li><code>${esc(value)}</code></li>`).join("")}</ul>
          </article>`
      : "";

  const body = `
      <div class="page-header">
        <h1>Session Timeline</h1>
        <p>Unified timeline merged from durable state. Lane filters control visibility.</p>
      </div>
      ${filterForm}
      ${queryErrorsHtml}
      <article class="card">
        <h2>Queue visibility</h2>
        <p class="muted">Inbound queue mode and pending items per lane.</p>
        <table>
          <thead><tr><th>Lane</th><th>Queue mode</th><th>Queued</th><th>Processing</th></tr></thead>
          <tbody>${queueSummaryRows}</tbody>
        </table>
      </article>
      <article class="card">
        <h3>Pending items</h3>
        <table>
          <thead><tr><th>Lane</th><th>Status</th><th>Mode</th><th>Received</th><th>Message</th><th>Preview</th></tr></thead>
          <tbody>${queueRowsHtml || "<tr><td colspan='6' class='muted'>No queued items.</td></tr>"}</tbody>
        </table>
      </article>
      <article class="card">
        <h2>Timeline</h2>
        <table>
          <thead><tr><th>Occurred</th><th>Lane</th><th>Kind</th><th>Detail</th></tr></thead>
          <tbody>${timelineRows || "<tr><td colspan='4' class='muted'>No timeline items.</td></tr>"}</tbody>
        </table>
      </article>
    `;

  return { html: shell("Session", "/app/session", search, body) };
}
