import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { APP_PATH_PREFIX, matchesPathPrefixSegment } from "../../app-path.js";
import { AUTH_COOKIE_NAME } from "../../modules/auth/http.js";
import {
  persistConsent,
  persistOperatingMode,
  snapshotConsent,
} from "../../modules/web/consent-store.js";
import {
  buildAuditTaskResponse,
  getPlanTimeline,
  listIntegrations,
  previewVoice,
  readProfiles,
  savePamProfile,
  savePvpProfile,
  setIntegrationPreference,
} from "../../modules/web/local-store.js";
import {
  AUTH_QUERY_PARAM,
  asRecord,
  boolFromForm,
  esc,
  formatJson,
  fmtDate,
  redirectWithMessageFromRequest,
  shell,
  withAuthToken,
} from "./html.js";
import { renderDashboardPage } from "./pages/dashboard.js";
import { renderLivePage } from "./pages/live.js";
import {
  renderOnboardingConsentPage,
  renderOnboardingPersonaPage,
  renderOnboardingRemoteTeamPage,
  renderOnboardingStartPage,
} from "./pages/onboarding.js";
import { renderSessionPage } from "./pages/session.js";
import {
  buildPamProfileFromForm,
  buildPvpProfileFromForm,
  renderSettingsPage,
} from "./pages/settings.js";
import { BASE_STYLE } from "./style.js";
import type { WebUiDeps } from "./types.js";

export function createWebUiRoutes(deps: WebUiDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tyrum</title>
  <style>${BASE_STYLE}</style>
</head>
<body>
  <main class="main" style="max-width: 900px; margin: 42px auto;">
    <div class="card">
      <h1>Tyrum</h1>
      <p class="muted">Self-hosted autonomous worker platform. Gateway now serves the full web app directly.</p>
      <div class="actions">
        <a href="${withAuthToken("/app", search)}"><button type="button">Open App</button></a>
        <a href="${withAuthToken("/app/settings", search)}"><button type="button" class="secondary">Open Settings</button></a>
      </div>
    </div>
  </main>
</body>
</html>`);
  });

  app.get("/consent", (c) => {
    const search = new URL(c.req.url).searchParams;
    const snap = snapshotConsent();
    const selected = Object.values(snap.selections).filter(Boolean).length;

    const body = `
      <div class="page-header">
        <h1>Consent Checklist</h1>
        <p>Review planner guardrails and persist your preferences.</p>
      </div>

      <article class="card">
        <div class="kv">
          <strong>Selected</strong><span>${String(selected)} / 3</span>
          <strong>Status</strong><span>${snap.revision > 0 ? "Recorded" : "Draft"}</span>
          <strong>Latest reference</strong><span>${esc(snap.auditReference)}</span>
        </div>
      </article>

      <form method="post" action="/app/actions/onboarding/consent">
        <article class="card">
          <label><input type="checkbox" name="shareCalendarSignals" value="true" ${snap.selections.shareCalendarSignals ? "checked" : ""}/> Share scheduling signals</label>
          <p class="helper">Allow Tyrum to read summaries of holds, cancellations, and travel windows.</p>

          <label><input type="checkbox" name="allowPlannerAutonomy" value="true" ${snap.selections.allowPlannerAutonomy ? "checked" : ""}/> Approve autopilot guardrails</label>
          <p class="helper">Permit autonomous actions while spend remains within your limits.</p>

          <label><input type="checkbox" name="retainAuditTrail" value="true" ${snap.selections.retainAuditTrail ? "checked" : ""}/> Retain consent audit trail</label>
          <p class="helper">Persist local proof of every guardrail decision for compliance and export.</p>

          <div class="actions"><button type="submit">Record consent selections</button></div>
        </article>
      </form>
    `;
    return c.html(shell("Consent", "/app/onboarding/consent", search, body));
  });

  app.get("/app/auth", (c) => {
    const search = new URL(c.req.url).searchParams;
    const token = search.get(AUTH_QUERY_PARAM)?.trim();
    const requestedNext = search.get("next") ?? APP_PATH_PREFIX;
    let nextPath = APP_PATH_PREFIX;
    try {
      const parsedNext = new URL(requestedNext, "http://tyrum.local");
      if (matchesPathPrefixSegment(parsedNext.pathname, APP_PATH_PREFIX)) {
        nextPath = `${parsedNext.pathname}${parsedNext.search}${parsedNext.hash}`;
      }
    } catch {
      // Ignore invalid next parameter and fall back to the app root.
    }
    const nextUrl = withAuthToken(nextPath, search);
    if (!token) {
      return c.redirect(nextUrl);
    }
    setCookie(c, AUTH_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 604800,
    });
    return c.redirect(nextUrl);
  });

  app.get("/app", async (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(await renderDashboardPage(deps, search));
  });

  app.get("/app/session", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const result = await renderSessionPage(deps, search);
    return c.html(result.html, result.status);
  });

  app.get("/app/live", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderLivePage(search));
  });

  app.get("/app/activity", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const events = await deps.memoryDal.getEpisodicEvents(100);
    const rows = events
      .map(
        (event) => `<tr>
          <td>${esc(event.event_id)}</td>
          <td>${esc(event.event_type)}</td>
          <td>${esc(event.channel)}</td>
          <td>${fmtDate(event.occurred_at)}</td>
          <td><pre><code>${formatJson(event.payload)}</code></pre></td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Activity</h1>
        <p>Live event stream from gateway memory.</p>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Channel</th><th>Occurred</th><th>Payload</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' class='muted'>No events yet.</td></tr>"}</tbody>
        </table>
      </div>
    `;
    return c.html(shell("Activity", "/app/activity", search, body));
  });

  app.get("/app/approvals", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const approvals = await deps.approvalDal.getByStatus("pending");

    const list = approvals
      .map(
        (approval) => `<article class="card">
          <h2>#${String(approval.id)}: ${esc(approval.prompt)}</h2>
          <p class="muted">Plan ${esc(approval.plan_id)} step ${String(approval.step_index)} · ${fmtDate(approval.created_at)}</p>
          <div class="actions">
            <a href="/app/approvals/${String(approval.id)}"><button class="secondary" type="button">Details</button></a>
            <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
              <input type="hidden" name="decision" value="approved" />
              <button type="submit">Approve</button>
            </form>
            <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
              <input type="hidden" name="decision" value="denied" />
              <button class="danger" type="submit">Deny</button>
            </form>
          </div>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Approvals</h1>
        <p>Review and respond to pending planner requests.</p>
      </div>
      ${list || "<div class='card'><p class='muted'>No pending approvals.</p></div>"}
    `;

    return c.html(shell("Approvals", "/app/approvals", search, body));
  });

  app.post("/app/actions/approvals/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/approvals", "Invalid approval id", "error"),
      );
    }

    const form = await c.req.formData();
    const decision = String(form.get("decision") ?? "");
    const approved = decision === "approved";
    const denied = decision === "denied";

    if (!approved && !denied) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/approvals", "Invalid approval decision", "error"),
      );
    }

    const updated = await deps.approvalDal.respond(id, approved, form.get("reason")?.toString());
    if (!updated) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/approvals",
          "Approval not found or already responded",
          "error",
        ),
      );
    }

    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/approvals",
        `Approval #${String(id)} ${approved ? "approved" : "denied"}`,
      ),
    );
  });

  app.get("/app/approvals/:id", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.html(
        shell(
          "Approval",
          "/app/approvals",
          search,
          "<h1>Approval</h1><p class='notice error'>Invalid approval id</p>",
        ),
        400,
      );
    }

    const approval = await deps.approvalDal.getById(id);
    if (!approval) {
      return c.html(
        shell(
          "Approval",
          "/app/approvals",
          search,
          "<h1>Approval</h1><p class='notice error'>Approval not found</p>",
        ),
        404,
      );
    }

    const actions =
      approval.status === "pending"
        ? `<div class="actions">
          <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
            <input type="hidden" name="decision" value="approved" />
            <button type="submit">Approve</button>
          </form>
          <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
            <input type="hidden" name="decision" value="denied" />
            <button class="danger" type="submit">Deny</button>
          </form>
        </div>`
        : "";

    const body = `
      <div class="page-header"><h1>Approval #${String(approval.id)}</h1></div>
      <div class="card">
        <div class="kv">
          <strong>Status</strong><span>${esc(approval.status)}</span>
          <strong>Plan</strong><span>${esc(approval.plan_id)}</span>
          <strong>Step</strong><span>${String(approval.step_index)}</span>
          <strong>Created</strong><span>${fmtDate(approval.created_at)}</span>
          <strong>Responded</strong><span>${fmtDate(approval.responded_at)}</span>
        </div>
        <h2>Prompt</h2>
        <p>${esc(approval.prompt)}</p>
        <h2>Context</h2>
        <pre><code>${formatJson(approval.context)}</code></pre>
        ${actions}
      </div>
      <p><a href="/app/approvals">Back to approvals</a></p>
    `;

    return c.html(shell(`Approval ${approval.id}`, "/app/approvals", search, body));
  });

  app.get("/app/playbooks", (c) => {
    const search = new URL(c.req.url).searchParams;
    const cards = deps.playbooks
      .map(
        (playbook) => `<article class="card">
          <h2>${esc(playbook.manifest.name)}</h2>
          <p class="muted">${esc(playbook.manifest.id)} · ${esc(playbook.manifest.version)}</p>
          <p>${esc(playbook.manifest.description ?? "No description")}</p>
          <p class="muted">${String(playbook.manifest.steps.length)} steps</p>
          <form method="post" action="/app/actions/playbooks/${encodeURIComponent(playbook.manifest.id)}/run">
            <button type="submit">Run</button>
          </form>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Playbooks</h1>
        <p>Trigger repeatable automation flows on demand.</p>
      </div>
      ${cards || "<div class='card'><p class='muted'>No playbooks loaded.</p></div>"}
    `;

    return c.html(shell("Playbooks", "/app/playbooks", search, body));
  });

  app.post("/app/actions/playbooks/:id/run", (c) => {
    const id = c.req.param("id");
    const playbook = deps.playbooks.find((entry) => entry.manifest.id === id);
    if (!playbook) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/playbooks", `Playbook '${id}' not found`, "error"),
      );
    }

    const run = deps.playbookRunner.run(playbook);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/playbooks",
        `Playbook ${playbook.manifest.name} executed (${run.steps.length} steps).`,
      ),
    );
  });

  app.get("/app/watchers", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const watchers = await deps.watcherProcessor.listWatchers();

    const list = watchers
      .map(
        (watcher) => `<article class="card">
          <h2>#${String(watcher.id)}</h2>
          <p class="muted">${esc(watcher.trigger_type)} · plan ${esc(watcher.plan_id)} · ${fmtDate(watcher.created_at)}</p>
          <pre><code>${formatJson(watcher.trigger_config)}</code></pre>
          <div class="actions">
            <form class="inline" method="post" action="/app/actions/watchers/${String(watcher.id)}/deactivate">
              <button class="secondary" type="submit">Deactivate</button>
            </form>
            <form class="inline" method="post" action="/app/actions/watchers/${String(watcher.id)}/delete">
              <button class="danger" type="submit">Delete</button>
            </form>
          </div>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Watchers</h1>
        <p>Manage periodic and completion-triggered watcher rules.</p>
      </div>
      <section class="card">
        <h2>Create watcher</h2>
        <form method="post" action="/app/actions/watchers/create">
          <label for="watcher-plan-id">Plan ID</label>
          <input id="watcher-plan-id" name="plan_id" required />

          <label for="watcher-trigger">Trigger Type</label>
          <select id="watcher-trigger" name="trigger_type">
            <option value="periodic">periodic</option>
            <option value="plan_complete">plan_complete</option>
          </select>

          <label for="watcher-interval">Interval (ms, periodic only)</label>
          <input id="watcher-interval" name="interval_ms" type="number" min="1000" value="60000" />

          <div class="actions"><button type="submit">Create</button></div>
        </form>
      </section>

      ${list || "<div class='card'><p class='muted'>No active watchers.</p></div>"}
    `;

    return c.html(shell("Watchers", "/app/watchers", search, body));
  });

  app.post("/app/actions/watchers/create", async (c) => {
    const form = await c.req.formData();
    const planId = form.get("plan_id")?.toString().trim();
    const triggerType = form.get("trigger_type")?.toString().trim();

    if (!planId || !triggerType) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/watchers",
          "Plan ID and trigger type are required",
          "error",
        ),
      );
    }

    const intervalMs = parseInt(form.get("interval_ms")?.toString() ?? "60000", 10);
    const triggerConfig =
      triggerType === "periodic"
        ? { intervalMs: Number.isFinite(intervalMs) ? intervalMs : 60000 }
        : {};

    const id = await deps.watcherProcessor.createWatcher(planId, triggerType, triggerConfig);
    return c.redirect(
      redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} created.`),
    );
  });

  app.post("/app/actions/watchers/:id/deactivate", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/watchers", "Invalid watcher id", "error"),
      );
    }

    await deps.watcherProcessor.deactivateWatcher(id);
    return c.redirect(
      redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} deactivated.`),
    );
  });

  app.post("/app/actions/watchers/:id/delete", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/watchers", "Invalid watcher id", "error"),
      );
    }

    await deps.watcherProcessor.deactivateWatcher(id);
    return c.redirect(
      redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} deleted.`),
    );
  });

  app.get("/app/canvas", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const artifacts = await deps.canvasDal.listRecent(100);

    const rows = artifacts
      .map(
        (artifact) => `<tr>
          <td><a href="/app/canvas/${encodeURIComponent(artifact.id)}">${esc(artifact.title)}</a></td>
          <td>${esc(artifact.id)}</td>
          <td>${esc(artifact.content_type)}</td>
          <td>${fmtDate(artifact.created_at)}</td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Canvas</h1>
        <p>Recent canvas artifacts generated by automation runs.</p>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Title</th><th>ID</th><th>Type</th><th>Created</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='4' class='muted'>No canvas artifacts available.</td></tr>"}</tbody>
        </table>
      </div>
    `;

    return c.html(shell("Canvas", "/app/canvas", search, body));
  });

  app.get("/app/canvas/:id", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const id = c.req.param("id");
    const artifact = await deps.canvasDal.getById(id);

    if (!artifact) {
      return c.html(
        shell(
          "Canvas",
          "/app/canvas",
          search,
          "<h1>Canvas</h1><p class='notice error'>Canvas artifact not found.</p>",
        ),
        404,
      );
    }

    const body = `
      <div class="page-header"><h1>Canvas Artifact</h1></div>
      <div class="card">
        <div class="kv">
          <strong>ID</strong><span>${esc(artifact.id)}</span>
          <strong>Title</strong><span>${esc(artifact.title)}</span>
          <strong>Content Type</strong><span>${esc(artifact.content_type)}</span>
          <strong>Created</strong><span>${fmtDate(artifact.created_at)}</span>
        </div>
      </div>
      <div class="card">
        <iframe title="Canvas" src="/canvas/${encodeURIComponent(artifact.id)}" style="width:100%; min-height: 480px; border:1px solid #dbe3f1; border-radius:8px"></iframe>
      </div>
      <p><a href="/app/canvas">Back to canvas</a></p>
    `;

    return c.html(shell(`Canvas ${artifact.id}`, "/app/canvas", search, body));
  });

  app.get("/app/settings", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderSettingsPage(search));
  });

  app.post("/app/actions/settings/pam", async (c) => {
    const form = await c.req.formData();
    const result = buildPamProfileFromForm(form);
    if (!result.ok) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/settings", result.message, "error"),
      );
    }

    savePamProfile(result.profile);
    return c.redirect(
      redirectWithMessageFromRequest(c, "/app/settings", "Autonomy preferences saved."),
    );
  });

  app.post("/app/actions/settings/pvp", async (c) => {
    const form = await c.req.formData();
    const result = buildPvpProfileFromForm(form);
    if (!result.ok) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/settings", result.message, "error"),
      );
    }

    savePvpProfile(result.profile);
    return c.redirect(
      redirectWithMessageFromRequest(c, "/app/settings", "Persona preferences saved."),
    );
  });

  app.post("/app/actions/settings/voice-preview", (c) => {
    const profiles = readProfiles();
    const pvpProfile = asRecord(profiles.pvp?.profile);
    if (!profiles.pvp?.version) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/settings",
          "Save your persona profile before requesting a preview.",
          "error",
        ),
      );
    }

    const voice = asRecord(pvpProfile?.voice);
    const voiceId = typeof voice?.voice_id === "string" ? voice.voice_id.trim() : "";
    if (!voiceId) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/settings",
          "Set a voice ID before requesting a preview.",
          "error",
        ),
      );
    }

    const preview = previewVoice();
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/settings",
        `Voice preview generated for '${voiceId}' (${preview.format}, ${preview.audio_base64.length} bytes base64).`,
      ),
    );
  });

  app.post("/app/actions/account/:action", (c) => {
    const action =
      c.req.param("action") === "delete"
        ? "delete"
        : c.req.param("action") === "export"
          ? "export"
          : null;
    if (!action) {
      return c.redirect(
        redirectWithMessageFromRequest(c, "/app/settings", "Unsupported account action.", "error"),
      );
    }

    const response = buildAuditTaskResponse(action);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/settings",
        `${action === "delete" ? "Delete" : "Export"} request enqueued (${response.task.auditReference}).`,
      ),
    );
  });

  app.get("/app/linking", (c) => {
    const search = new URL(c.req.url).searchParams;
    const integrations = listIntegrations();

    const cards = integrations.integrations
      .map(
        (integration) => `<article class="card">
          <h2>${esc(integration.name)}</h2>
          <p class="muted">${esc(integration.slug)}</p>
          <p>${esc(integration.description)}</p>
          <p><strong>Status:</strong> ${integration.enabled ? "Enabled" : "Disabled"}</p>
          <form method="post" action="/app/actions/linking/${encodeURIComponent(integration.slug)}">
            <input type="hidden" name="enabled" value="${integration.enabled ? "false" : "true"}" />
            <button type="submit" class="${integration.enabled ? "danger" : ""}">${integration.enabled ? "Disable" : "Enable"}</button>
          </form>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Account Linking</h1>
        <p>Toggle placeholder connectors while integration controls remain local-only.</p>
      </div>
      <p class="muted">Account ID: ${esc(integrations.account_id)}</p>
      ${cards}
    `;

    return c.html(shell("Linking", "/app/linking", search, body));
  });

  app.post("/app/actions/linking/:slug", async (c) => {
    const slug = c.req.param("slug");
    const form = await c.req.formData();
    const enabled = boolFromForm(form.get("enabled"));

    const integration = setIntegrationPreference(slug, enabled);
    if (!integration) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/linking",
          `Integration '${slug}' not found`,
          "error",
        ),
      );
    }

    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/linking",
        `${integration.name} ${integration.enabled ? "enabled" : "disabled"}.`,
      ),
    );
  });

  app.get("/app/onboarding/start", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderOnboardingStartPage(search));
  });

  app.post("/app/actions/onboarding/mode", async (c) => {
    const form = await c.req.formData();
    const mode = form.get("mode")?.toString().trim();
    if (mode !== "embedded" && mode !== "remote") {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/start",
          "Select Local-Personal or Remote-Team mode to continue.",
          "error",
        ),
      );
    }

    if (mode === "embedded") {
      persistOperatingMode("local-personal");
      const search = new URL(c.req.url).searchParams;
      return c.redirect(withAuthToken("/app/onboarding/persona", search));
    }

    persistOperatingMode("remote-team");
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/remote-team",
        "Remote-team mode selected. Confirm hardening controls before continuing.",
      ),
    );
  });

  app.get("/app/onboarding/remote-team", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderOnboardingRemoteTeamPage(search));
  });

  app.post("/app/actions/onboarding/remote-team", async (c) => {
    const form = await c.req.formData();

    const ownerBootstrapConfirmed = boolFromForm(form.get("ownerBootstrapConfirmed"));
    const nonLocalDeviceApproval = boolFromForm(form.get("nonLocalDeviceApproval"));
    const deviceBoundTokens = boolFromForm(form.get("deviceBoundTokens"));
    const trustedProxyAllowlist = boolFromForm(form.get("trustedProxyAllowlist"));
    const tlsReady = boolFromForm(form.get("tlsReady"));
    const adminModeStepUp = boolFromForm(form.get("adminModeStepUp"));
    const tlsPinning = boolFromForm(form.get("tlsPinning"));

    const deploymentProfileValue = form.get("deploymentProfile")?.toString().trim();
    const stateStoreValue = form.get("stateStore")?.toString().trim();

    const deploymentProfile =
      deploymentProfileValue === "single-host" || deploymentProfileValue === "split-role"
        ? deploymentProfileValue
        : undefined;
    const stateStore =
      stateStoreValue === "sqlite" || stateStoreValue === "postgres" ? stateStoreValue : undefined;

    if (
      !ownerBootstrapConfirmed ||
      !nonLocalDeviceApproval ||
      !deviceBoundTokens ||
      !trustedProxyAllowlist ||
      !tlsReady ||
      !adminModeStepUp
    ) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Confirm every required hardening control before continuing.",
          "error",
        ),
      );
    }

    if (!deploymentProfile || !stateStore) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Choose deployment profile and StateStore before continuing.",
          "error",
        ),
      );
    }

    persistOperatingMode("remote-team", {
      ownerBootstrapConfirmed,
      nonLocalDeviceApproval,
      deviceBoundTokens,
      trustedProxyAllowlist,
      tlsReady,
      adminModeStepUp,
      tlsPinning,
      deploymentProfile,
      stateStore,
    });

    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/consent",
        "Remote-team hardening recorded. Continue with consent calibration.",
      ),
    );
  });

  app.get("/app/onboarding/persona", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderOnboardingPersonaPage(search));
  });

  app.get("/app/onboarding/consent", (c) => {
    const search = new URL(c.req.url).searchParams;
    const result = renderOnboardingConsentPage(search);
    if (result.type === "redirect") {
      return c.redirect(result.location);
    }
    return c.html(result.html);
  });

  app.post("/app/actions/onboarding/consent", async (c) => {
    const snapshot = snapshotConsent();
    if (snapshot.mode === "remote-team" && !snapshot.remoteHardening) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Complete remote-team hardening before recording consent.",
          "error",
        ),
      );
    }
    const form = await c.req.formData();
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const completedAt = new Date().toISOString();

    const selections = {
      shareCalendarSignals: boolFromForm(form.get("shareCalendarSignals")),
      allowPlannerAutonomy: boolFromForm(form.get("allowPlannerAutonomy")),
      retainAuditTrail: boolFromForm(form.get("retainAuditTrail")),
    };

    const persona = {
      tone: form.get("tone")?.toString(),
      verbosity: form.get("verbosity")?.toString(),
      initiative: form.get("initiative")?.toString(),
      quietHours: form.get("quietHours")?.toString(),
      spending: form.get("spending")?.toString(),
      voice: form.get("voice")?.toString(),
    };

    const calibration = Object.values(persona).some(Boolean)
      ? {
          persona,
          startedAt,
          completedAt,
          durationSeconds: Math.max(
            0,
            Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000),
          ),
        }
      : undefined;

    const record = persistConsent(selections, calibration);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/consent",
        `Consent recorded (${record.auditReference}, revision ${String(record.revision)}).`,
      ),
    );
  });

  app.get("/app/plans/:planId/timeline", (c) => {
    const search = new URL(c.req.url).searchParams;
    const planId = c.req.param("planId");
    const timeline = getPlanTimeline(planId);

    if (!timeline) {
      return c.html(
        shell(
          "Plan Timeline",
          "/app/activity",
          search,
          `<h1>Plan Timeline</h1><p class='notice error'>No timeline found for ${esc(planId)}.</p>`,
        ),
        404,
      );
    }

    const rows = timeline.events
      .map(
        (event) => `<tr>
          <td>${String(event.step_index)}</td>
          <td>${fmtDate(event.occurred_at)}</td>
          <td><pre><code>${formatJson(event.action)}</code></pre></td>
          <td>${esc(event.redactions.join(", ") || "none")}</td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header"><h1>Plan Timeline</h1></div>
      <div class="card">
        <div class="kv">
          <strong>Plan ID</strong><span>${esc(timeline.plan_id)}</span>
          <strong>Generated</strong><span>${fmtDate(timeline.generated_at)}</span>
          <strong>Events</strong><span>${String(timeline.event_count)}</span>
          <strong>Redactions</strong><span>${timeline.has_redactions ? "yes" : "no"}</span>
        </div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Step</th><th>Occurred</th><th>Action</th><th>Redactions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    return c.html(shell("Plan Timeline", "/app/activity", search, body));
  });

  return app;
}
